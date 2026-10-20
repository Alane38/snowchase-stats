-- Snow Chase : logger de sessions complet (à placer dans ServerScriptService, Script serveur)
-- Prérequis : Game Settings > Security > "Allow HTTP Requests" activé.
-- Événements : server_start / server_end (durée, pic de joueurs), join (identité, ancienneté, Premium, région,
-- provenance), leave (durée de session), death (position, durée de vie), purchase (passes et produits),
-- client (appareil, écran, entrée), beat toutes les 15 s (serveur : FPS, mémoire ; joueurs : ping, position,
-- vie, équipe, leaderstats). Envoi par lots toutes les 60 s pour limiter les écritures.
local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local LocalizationService = game:GetService("LocalizationService")
local MarketplaceService = game:GetService("MarketplaceService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Stats = game:GetService("Stats")

local ENDPOINT = "https://snowchase-stats.vercel.app/api/ingest"
local KEY = "REMPLACER_PAR_INGEST_KEY" -- même valeur que la variable INGEST_KEY sur Vercel
local BEAT_EVERY = 15
local FLUSH_EVERY = 60  -- limite HttpService = 500 requêtes/min/serveur
local MAX_BATCH = 50

if RunService:IsStudio() then return end -- ne rien envoyer depuis Studio

local queue, joined, alive = {}, {}, {}
local started, peak = os.time(), 0

local function push(ev)
	ev.t = os.time()
	ev.job = game.JobId
	ev.v = game.PlaceVersion
	table.insert(queue, ev)
end

local function sendOne()
	local n = math.min(#queue, MAX_BATCH)
	local batch = table.move(queue, 1, n, 1, {})
	for _ = 1, n do table.remove(queue, 1) end
	local ok, res = pcall(function()
		return HttpService:RequestAsync({
			Url = ENDPOINT, Method = "POST",
			Headers = { ["Content-Type"] = "application/json", ["x-key"] = KEY },
			Body = HttpService:JSONEncode({ events = batch }),
		})
	end)
	if not ok or not res.Success then -- on remet en file (bornée) pour réessayer
		for i = #batch, 1, -1 do if #queue < 1000 then table.insert(queue, 1, batch[i]) end end
		return false
	end
	return true
end

local function flush()
	local guard = 0
	while #queue > 0 and guard < 4 do
		guard += 1
		if not sendOne() then break end
	end
end

-- client : appareil, écran, entrée principale (reçu depuis SnowChaseClient)
local remote = Instance.new("RemoteEvent")
remote.Name = "SnowChaseInfo"
remote.Parent = ReplicatedStorage
local seenClient = {}
remote.OnServerEvent:Connect(function(p, info)
	if seenClient[p] or type(info) ~= "table" then return end
	seenClient[p] = true
	push({ type = "client", uid = p.UserId, name = p.Name,
		dev = tostring(info.device or ""):sub(1, 12), w = tonumber(info.w), h = tonumber(info.h),
		inp = tostring(info.input or ""):sub(1, 12), fpsc = tonumber(info.fps) })
end)

push({ type = "server_start", n = #Players:GetPlayers(), srv = game.PrivateServerId ~= "" and "private" or "public",
	max = Players.MaxPlayers })

local function watchCharacter(p, ch)
	local hum = ch:WaitForChild("Humanoid", 10)
	if not hum then return end
	alive[p] = os.time()
	hum.Died:Connect(function()
		local root = ch:FindFirstChild("HumanoidRootPart")
		push({ type = "death", uid = p.UserId, name = p.Name, dur = os.time() - (alive[p] or os.time()),
			x = root and math.floor(root.Position.X) or nil, y = root and math.floor(root.Position.Y) or nil,
			z = root and math.floor(root.Position.Z) or nil })
	end)
end

local function onAdded(p)
	joined[p] = os.time()
	peak = math.max(peak, #Players:GetPlayers())
	local jd = p:GetJoinData()
	local region
	pcall(function() region = LocalizationService:GetCountryRegionForPlayerAsync(p) end)
	push({ type = "join", uid = p.UserId, name = p.Name, dn = p.DisplayName, n = #Players:GetPlayers(),
		src = (jd and jd.SourcePlaceId) and "teleport" or "direct", from = jd and jd.SourcePlaceId or nil,
		acct = p.AccountAge, prem = p.MembershipType == Enum.MembershipType.Premium,
		loc = p.LocaleId, reg = region, srv = game.PrivateServerId ~= "" and "private" or "public" })
	p.CharacterAdded:Connect(function(ch) watchCharacter(p, ch) end)
	if p.Character then task.spawn(watchCharacter, p, p.Character) end
end

Players.PlayerAdded:Connect(onAdded)
for _, p in ipairs(Players:GetPlayers()) do task.spawn(onAdded, p) end

Players.PlayerRemoving:Connect(function(p)
	local t0 = joined[p]; joined[p] = nil; alive[p] = nil; seenClient[p] = nil
	push({ type = "leave", uid = p.UserId, name = p.Name, n = #Players:GetPlayers() - 1,
		dur = t0 and (os.time() - t0) or nil })
end)

MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(p, id, bought)
	push({ type = "purchase", uid = p.UserId, name = p.Name, kind = "pass", id = id, ok = bought })
end)
MarketplaceService.PromptProductPurchaseFinished:Connect(function(uid, id, bought)
	push({ type = "purchase", uid = uid, kind = "product", id = id, ok = bought })
end)

local function r1(x) return math.floor(x * 10 + 0.5) / 10 end

local function snapshotPlayer(p)
	local d = { ping = math.floor(p:GetNetworkPing() * 1000), t = os.time() - (joined[p] or os.time()) }
	d.team = p.Team and p.Team.Name or nil
	local ch = p.Character
	local hum = ch and ch:FindFirstChildOfClass("Humanoid")
	local root = ch and ch:FindFirstChild("HumanoidRootPart")
	if hum then d.hp = math.floor(hum.Health); d.mhp = math.floor(hum.MaxHealth); d.ws = r1(hum.WalkSpeed) end
	if root then d.x, d.y, d.z = math.floor(root.Position.X), math.floor(root.Position.Y), math.floor(root.Position.Z) end
	local ls = p:FindFirstChild("leaderstats") -- toutes les stats visibles du jeu (score, etc.)
	if ls then
		d.ls = {}
		for _, v in ipairs(ls:GetChildren()) do
			if v:IsA("ValueBase") then d.ls[v.Name] = (type(v.Value) == "number" or type(v.Value) == "string") and v.Value or tostring(v.Value) end
		end
	end
	return d
end

task.spawn(function() -- battement du serveur + état de chaque joueur
	while true do
		task.wait(BEAT_EVERY)
		local pl = {}
		for _, p in ipairs(Players:GetPlayers()) do
			local ok, d = pcall(snapshotPlayer, p)
			if ok then pl[tostring(p.UserId)] = d end
		end
		push({ type = "beat", n = #Players:GetPlayers(), fps = math.floor(workspace:GetRealPhysicsFPS()),
			up = os.time() - started, mem = math.floor(Stats:GetTotalMemoryUsageMb()), pl = pl })
	end
end)

task.spawn(function() while true do task.wait(FLUSH_EVERY); flush() end end)
game:BindToClose(function()
	push({ type = "server_end", n = #Players:GetPlayers(), up = os.time() - started, peak = peak })
	flush()
end)
