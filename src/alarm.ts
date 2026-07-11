import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import notifier from "node-notifier";
import { log } from "./log.js";

let proc: ChildProcess | null = null;

/** Toca um alarme ALTO em loop (WAV do Windows) + notificacao desktop. Acorda o usuario. */
export function startAlarm(message = "VAGA! Chegou no pagamento - confira, pague e faca o OTP"): void {
  if (proc) return;
  const wavs = ["C:\\Windows\\Media\\Alarm01.wav", "C:\\Windows\\Media\\Ring01.wav", "C:\\Windows\\Media\\Ring05.wav", "C:\\Windows\\Media\\notify.wav"];
  const wav = wavs.find((w) => existsSync(w));
  const ps = wav
    ? `$p=New-Object Media.SoundPlayer '${wav}';$p.PlayLooping();while($true){Start-Sleep -Seconds 1}`
    : `while($true){[console]::beep(1200,500);Start-Sleep -Milliseconds 300}`;
  try {
    proc = spawn("powershell", ["-NoProfile", "-Command", ps], { detached: true, stdio: "ignore" });
    proc.unref();
    log.warn(">>>>> ALARME LIGADO <<<<< " + message);
  } catch (e) {
    log.warn("alarme (som) falhou: " + String(e));
  }
  try {
    notifier.notify({ title: "WHV Aplicator", message, sound: true, wait: false });
  } catch {
    /* notificacao best-effort */
  }
}

export function stopAlarm(): void {
  if (!proc) return;
  try {
    if (proc.pid) spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  try {
    proc.kill();
  } catch {
    /* ignore */
  }
  proc = null;
  log.info("alarme desligado");
}
