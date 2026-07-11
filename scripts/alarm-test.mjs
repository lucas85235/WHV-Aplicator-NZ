// Testa o alarme por ~1.5s (liga e desliga). Confirma que faz barulho + para.
import { startAlarm, stopAlarm } from "../dist/src/alarm.js";
console.log("ligando alarme por 1.5s (vai tocar)...");
startAlarm("TESTE - alarme funcionando");
await new Promise((r) => setTimeout(r, 1500));
stopAlarm();
console.log("alarme parado. Se ouviu, funciona.");
setTimeout(() => process.exit(0), 500);
