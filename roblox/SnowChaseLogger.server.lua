-- Snow Chase : logger de sessions (à placer dans ServerScriptService, Script serveur)
-- Prérequis : Game Settings > Security > "Allow HTTP Requests" activé.
-- Envoie à notre endpoint : entrée/sortie de joueur, id de serveur (JobId), durée de session.
-- Aucun nom ni userId en clair n'est stocké : l'endpoint hache le userId avec un sel secret.
local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local ENDPOINT = "https://snowchase-stats.vercel.app/api/ingest"
local KEY = "REMPLACER_PAR_INGEST_KEY" -- même valeur que la variable INGEST_KEY sur Vercel
local FLUSH_EVERY = 15      -- secondes ; limite HttpService = 500 requêtes/min/serveur
local MAX_BATCH = 50

if RunService:IsStudio() then return end -- ne rien envoyer depuis Studio

local queue, joined = {}, {}

local function push(ev)
	ev.t = os.time()
	ev.job = game.JobId
	ev.v = game.PlaceVersion
	table.insert(queue, ev)
end

local function flush()
	if #queue == 0 then return end
	local n = math.min(#queue, MAX_BATCH)
	local batch = table.move(queue, 1, n, 1, {})
	for _ = 1, n do table.remove(queue, 1) end
	local ok = pcall(function()
		HttpService:RequestAsync({
			Url = ENDPOINT, Method = "POST",
			Headers = { ["Content-Type"] = "application/json", ["x-key"] = KEY },
			Body = HttpService:JSONEncode({ events = batch }),
		})
	end)
	if not ok then -- on remet en file (bornée) pour réessayer
		for i = #batch, 1, -1 do if #queue < 500 then table.insert(queue, 1, batch[i]) end end
	end
end

local function onAdded(p)
	joined[p] = os.time()
	local jd = p:GetJoinData()
	push({ type = "join", uid = p.UserId, n = #Players:GetPlayers(),
		src = jd and jd.SourcePlaceId and "teleport" or "direct",
		acct = p.AccountAge })
end

Players.PlayerAdded:Connect(onAdded)
for _, p in ipairs(Players:GetPlayers()) do task.spawn(onAdded, p) end

Players.PlayerRemoving:Connect(function(p)
	local t0 = joined[p]; joined[p] = nil
	push({ type = "leave", uid = p.UserId, n = #Players:GetPlayers() - 1,
		dur = t0 and (os.time() - t0) or nil })
end)

task.spawn(function() while true do task.wait(FLUSH_EVERY); flush() end end)
game:BindToClose(function() flush() end)
