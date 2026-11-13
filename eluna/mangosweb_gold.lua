-- MaNGOSWebV5 gold bridge for ALE (AzerothCore Lua Engine) / Eluna.
--
-- Install: copy this file into the worldserver's lua_scripts folder and run
-- `.reload eluna` (or restart). The website calls these console commands over SOAP:
--
--   mwgold ping
--   mwgold balance <character>
--   mwgold charge  <character> <copper> <ref>
--   mwgold credit  <character> <copper> <ref>
--
-- Replies start with "MWGOLD OK ..." or "MWGOLD FAIL <ref> <REASON>".
-- Only console/SOAP callers are served; a player typing the command is ignored.
-- Works on online characters (live) and on offline ones (guarded SQL update).

local PLAYER_EVENT_ON_COMMAND = 42
local MAX_MONEY = 2147483646
local REF_LIMIT = 5000

local processed = {}
local processedCount = 0

local function reply(handler, msg)
    if handler then handler:SendSysMessage(msg) end
    print("[mwgold] " .. msg)
end

local function remember(ref, line)
    if processedCount >= REF_LIMIT then
        processed = {}
        processedCount = 0
    end
    processed[ref] = line
    processedCount = processedCount + 1
    return line
end

local function validName(name)
    return name ~= nil and #name >= 2 and #name <= 36 and name:match("^[%a\128-\255]+$") ~= nil
end

local function validAmount(text)
    local n = tonumber(text)
    if not n or n ~= math.floor(n) or n < 1 or n > MAX_MONEY then return nil end
    return n
end

local function offlineRow(name)
    local q = CharDBQuery("SELECT guid, money, online FROM characters WHERE name = '" .. name ..
        "' AND deleteDate IS NULL LIMIT 1")
    if not q then return nil end
    return { guid = q:GetUInt32(0), money = q:GetUInt32(1), online = q:GetUInt8(2) }
end

local function balance(name)
    local p = GetPlayerByName(name)
    if p then return p:GetCoinage() end
    local row = offlineRow(name)
    return row and row.money or nil
end

local function charge(name, amount, ref)
    local p = GetPlayerByName(name)
    if p then
        local coin = p:GetCoinage()
        if coin < amount then return "MWGOLD FAIL " .. ref .. " FUNDS" end
        p:ModifyMoney(-amount)
        return "MWGOLD OK " .. ref .. " " .. (coin - amount)
    end

    local row = offlineRow(name)
    if not row then return "MWGOLD FAIL " .. ref .. " NOT_FOUND" end
    if row.online ~= 0 then return "MWGOLD FAIL " .. ref .. " BUSY" end
    if row.money < amount then return "MWGOLD FAIL " .. ref .. " FUNDS" end
    CharDBExecute("UPDATE characters SET money = money - " .. amount .. " WHERE guid = " .. row.guid ..
        " AND online = 0 AND money >= " .. amount)
    return "MWGOLD OK " .. ref .. " " .. (row.money - amount)
end

local function credit(name, amount, ref)
    local p = GetPlayerByName(name)
    if p then
        local before = p:GetCoinage()
        p:ModifyMoney(amount)
        local after = p:GetCoinage()
        if after - before ~= amount then return "MWGOLD FAIL " .. ref .. " CAP" end
        return "MWGOLD OK " .. ref .. " " .. after
    end

    local row = offlineRow(name)
    if not row then return "MWGOLD FAIL " .. ref .. " NOT_FOUND" end
    if row.online ~= 0 then return "MWGOLD FAIL " .. ref .. " BUSY" end
    if row.money + amount > MAX_MONEY then return "MWGOLD FAIL " .. ref .. " CAP" end
    CharDBExecute("UPDATE characters SET money = money + " .. amount .. " WHERE guid = " .. row.guid ..
        " AND online = 0")
    return "MWGOLD OK " .. ref .. " " .. (row.money + amount)
end

local function onCommand(event, player, command, handler)
    if player ~= nil then return end -- only console / SOAP

    local cmd, rest = tostring(command):match("^[%.#]?(%S+)%s*(.*)$")
    if not cmd or cmd:lower() ~= "mwgold" then return end

    local verb, name, amountText, ref = rest:match("^(%S+)%s*(%S*)%s*(%S*)%s*(%S*)")
    verb = verb and verb:lower() or ""

    if verb == "ping" then
        reply(handler, "MWGOLD OK ping 0")
        return false
    end

    if not validName(name) then
        reply(handler, "MWGOLD FAIL " .. (ref ~= "" and ref or "-") .. " BAD_NAME")
        return false
    end

    if verb == "balance" then
        local coin = balance(name)
        reply(handler, coin and ("MWGOLD OK balance " .. coin) or "MWGOLD FAIL balance NOT_FOUND")
        return false
    end

    if verb == "charge" or verb == "credit" then
        local amount = validAmount(amountText)
        if not amount or not ref:match("^[%w_%-]+$") or #ref > 40 then
            reply(handler, "MWGOLD FAIL " .. (ref ~= "" and ref or "-") .. " BAD_ARGS")
            return false
        end

        local key = verb .. ":" .. ref
        local line = processed[key]
        if not line then
            line = remember(key, verb == "charge" and charge(name, amount, ref) or credit(name, amount, ref))
        end
        reply(handler, line)
        return false
    end

    reply(handler, "MWGOLD FAIL - BAD_COMMAND")
    return false
end

RegisterPlayerEvent(PLAYER_EVENT_ON_COMMAND, onCommand)
print("[mwgold] MaNGOSWebV5 gold bridge loaded")
