-- Snow Chase : infos d'appareil (à placer dans StarterPlayerScripts, LocalScript).
-- Envoie une seule fois au serveur : type d'appareil, taille d'écran, entrée principale, FPS client.
local UIS = game:GetService("UserInputService")
local RS = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local remote = ReplicatedStorage:WaitForChild("SnowChaseInfo", 30)
if not remote then return end

local cam = workspace.CurrentCamera
task.wait(8) -- laisser la partie se charger avant de mesurer
local frames, t0 = 0, os.clock()
local c = RS.RenderStepped:Connect(function() frames += 1 end)
task.wait(3)
c:Disconnect()
local fps = math.floor(frames / math.max(os.clock() - t0, 0.1))

local device = UIS.TouchEnabled and not UIS.KeyboardEnabled and "mobile"
	or (UIS.GamepadEnabled and not UIS.KeyboardEnabled and "console")
	or (UIS.VREnabled and "vr") or "pc"
local input = UIS.GamepadEnabled and "gamepad" or (UIS.TouchEnabled and "touch" or "clavier")
local v = cam and cam.ViewportSize or Vector2.new(0, 0)
remote:FireServer({ device = device, w = math.floor(v.X), h = math.floor(v.Y), input = input, fps = fps })
