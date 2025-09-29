import { testRunner } from './TestRunner.js'
/*
// ========== UTILITA' PER CREARE TEST PAYLOAD ==========
function createTestPayload(fase, side, line, metrics) {
    const faseMap = { 4: 0, 8: 1, 12: 2 };
    const sideMap = { 'A': 0, 'B': 1 };
    const lineMap = { 1: 0, 2: 1 };

    // Costruisce header
    const headerByte = 0x80 | // start bit = 1
        (faseMap[fase] << 5) |
        (sideMap[side] << 3) |
        (lineMap[line] << 1);

    const bytes = [headerByte];

    // Aggiunge metriche
    metrics.forEach(metric => {
        const opcode = (metric.id << 2) | (metric.length || 0);
        bytes.push(opcode);

        if (metric.value !== undefined) {
            if (typeof metric.value === 'string') {
                // Per stringhe (come boot timestamp)
                for (let char of metric.value) {
                    bytes.push(char.charCodeAt(0));
                }
            } else {
                // Per valori numerici
                const valueLength = metric.length === 0 ? 1 : metric.length === 1 ? 2 : metric.length === 2 ? 3 : 4;
                const value = metric.value;

                if (valueLength === 1) {
                    bytes.push(value & 0xFF);
                } else if (valueLength === 2) {
                    bytes.push((value >> 8) & 0xFF);
                    bytes.push(value & 0xFF);
                }
                // Aggiungi altri casi se necessario
            }
        }
    });

    return bytes;
}

// Esempio di utilizzo della utility
console.log("\n🛠️  UTILITY PER CREARE PAYLOAD DI TEST:");
console.log("Esempio: Fase 8A Linea 1 con media tiro 150kN e temperatura 25°C");
const examplePayload = createTestPayload(8, 'A', 1, [
    { id: 1, length: 0, value: 150 }, // media tiro
    { id: 4, length: 0, value: 75 }   // temperatura (75-50=25°C)
]);
console.log("Payload:", examplePayload.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
*/

// ========== ESEGUI TUTTI I TEST ==========
testRunner.run();
