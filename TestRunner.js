import { decodeUplink } from './plugin.js';

// ========== TEST FRAMEWORK ==========
class TestRunner {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
    }

    addTest(name, testFunc) {
        this.tests.push({ name, testFunc });
    }

    run() {
        console.log("🚀 Avvio Test Suite per Payload Formatter\n");
        console.log("=".repeat(60));

        this.tests.forEach((test, index) => {
            try {
                console.log(`\n📋 Test ${index + 1}: ${test.name}`);
                console.log("-".repeat(40));
                test.testFunc();
                this.passed++;
                console.log("✅ PASSED");
            } catch (error) {
                this.failed++;
                console.log(`❌ FAILED: ${error.message}`);
            }
        });

        this.printSummary();
    }

    printSummary() {
        console.log("\n" + "=".repeat(60));
        console.log("📊 RISULTATI FINALI");
        console.log("=".repeat(60));
        console.log(`✅ Test Passati: ${this.passed}`);
        console.log(`❌ Test Falliti: ${this.failed}`);
        console.log(`📈 Tasso di Successo: ${((this.passed / this.tests.length) * 100).toFixed(1)}%`);
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertDeepEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${message}\nAtteso: ${JSON.stringify(expected)}\nOttenuto: ${JSON.stringify(actual)}`);
    }
}

// ========== TEST CASES ==========

const testRunner = new TestRunner();

// Test 1: Payload vuoto
testRunner.addTest("Payload Vuoto", () => {
    const input = { bytes: [], fPort: 1 };
    const result = decodeUplink(input);

    console.log("Input:", JSON.stringify(input));
    console.log("Output:", JSON.stringify(result, null, 2));

    assert(result.data, "Deve avere campo data");
    assert(result.warnings.length > 0, "Deve avere warnings per payload vuoto");
});

// Test 2: Header parsing
testRunner.addTest("Header Parsing - Fase 4A Linea 1", () => {
    // Header: 1 0 0 0 0 0 0 0 = 0x80 (start=1, fase=00=4, side=00=A, line=00=1)
    // + metrica media tiro: 0x04 (id=1, length=00) + valore 120
    const input = { bytes: [0x80, 0x04, 120], fPort: 1 };
    const result = decodeUplink(input);

    console.log("Input bytes:", input.bytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
    console.log("Output:", JSON.stringify(result, null, 2));

    assert(result.data.metrics['SENS_FBG_TC_F4A_L1.avg'] === 120, "Deve decodificare media tiro F4A_L1");
});

// Test 3: Temperatura con offset
testRunner.addTest("Temperatura con Offset", () => {
    // Header: 0x80 + metrica temp media: 0x10 (id=4, length=00) + valore 75
    const input = { bytes: [0x80, 0x10, 75], fPort: 1 };
    const result = decodeUplink(input);

    console.log("Input bytes:", input.bytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
    console.log("Output:", JSON.stringify(result, null, 2));

    assert(result.data.metrics['SENS_FBG_Temp_F4A_L1.avg'] === 25, "Deve applicare offset -50 alla temperatura (75-50=25)");
});

// Test 4: Metriche multiple
testRunner.addTest("Metriche Multiple", () => {
    // Header F8B_L2: 1 01 01 01 0 = 0xAA
    // Media tiro: 0x04 + 150, Max tiro: 0x08 + 180, Batteria: 0x1C + 85
    const input = { bytes: [0xAA, 0x04, 150, 0x08, 180, 0x1C, 85], fPort: 1 };
    const result = decodeUplink(input);

    console.log("Input bytes:", input.bytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
    console.log("Output:", JSON.stringify(result, null, 2));

    assert(result.data.metrics['SENS_FBG_TC_F8B_L2.avg'] === 150, "Media tiro F8B_L2");
    assert(result.data.metrics['SENS_FBG_TC_F8B_L2.max'] === 180, "Max tiro F8B_L2");
    assert(result.data.metrics['ALG_FBG_Liv_Batteria.calc'] === 85, "Livello batteria");
});

// Test 5: Allarmi
testRunner.addTest("Allarmi e Warning", () => {
    // Header F12A_L1: 1 10 00 00 0 = 0xC0
    // Allarme tiro basso: 0x80 (id=32, length=00) + 1, Warning tiro alto: 0x8C (id=35, length=00) + 1
    const input = { bytes: [0xC0, 0x80, 1, 0x8C, 1], fPort: 1 };
    const result = decodeUplink(input);

    console.log("Input bytes:", input.bytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
    console.log("Output:", JSON.stringify(result, null, 2));

    assert(result.data.metrics['ALG_FBG_Alm_Tiro_Bassa_F12A_L1.calc'] === 1, "Allarme tiro basso F12A_L1");
    assert(result.data.metrics['ALG_FBG_Warn_Tiro_Max_F12A_L1.calc'] === 1, "Warning tiro alto F12A_L1");
});

// Test 6: Evento Device Boot
testRunner.addTest("Evento Device Boot", () => {
    // Header: 0x80 + evento boot: 0xA0 (id=40, length ignorato) + timestamp "20241201123000001"
    const bootTimestamp = "20251114110800001";
    const timestampBytes = Array.from(bootTimestamp).map(char => char.charCodeAt(0));
    const input = { bytes: [0x80, 0xA0, ...timestampBytes], fPort: 1 };
    const result = decodeUplink(input);
    

    console.log("Input bytes:", input.bytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
    console.log("Input base 64", base64ArrayBuffer(input.bytes))
    console.log("Output:", JSON.stringify(result, null, 2));

    assert(result.data.metrics['ALG_FBG_Start_Up_Device.calc'] === bootTimestamp, "Deve decodificare timestamp boot");
});

// Test 7: Valori a 2 byte
testRunner.addTest("Valori Multi-byte", () => {
    // Header: 0x80 + metrica con valore a 2 byte: 0x05 (id=1, length=01) + 0x0190 (400)
    const input = { bytes: [0x80, 0x05, 0x01, 0x90], fPort: 1 };
    const result = decodeUplink(input);

    console.log("Input bytes:", input.bytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
    console.log("Output:", JSON.stringify(result, null, 2));

    assert(result.data.metrics['SENS_FBG_TC_F4A_L1.avg'] === 400, "Deve decodificare valore a 2 byte");
});

// Test 8: Payload malformato
testRunner.addTest("Payload Malformato", () => {
    // Header + metrica che richiede più byte di quelli disponibili
    const input = { bytes: [0x80, 0x05], fPort: 1 }; // length=01 ma manca il secondo byte
    const result = decodeUplink(input);

    console.log("Input bytes:", input.bytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
    console.log("Output:", JSON.stringify(result, null, 2));

    assert(result.errors.length > 0, "Deve segnalare errore per payload malformato");
});

// Test 9: Caso reale
testRunner.addTest("Valori Multi-byte", () => {
    // Header: 0x80 + metrica con valore a 2 byte: 0x05 (id=1, length=01) + 0x0190 (400)
    const input = { bytes: [0x80, 0x08, 0x50, 0x04, 0x50,0x14,0x14,0x0C,0x50,0x18,0x14,0x10,0x14], fPort: 1 };
    const result = decodeUplink(input);

    console.log("Input bytes:", input.bytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
    console.log("Output:", JSON.stringify(result, null, 2));

    assert(result.data.metrics['SENS_FBG_TC_F4A_L1.avg'] === 400, "Deve decodificare valore a 2 byte");
});

function base64ArrayBuffer(bytes) {
  var base64    = ''
  var encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  console.log("[BASE64] bytes",bytes,bytes.length)
  var byteLength    = bytes.length
  var byteRemainder = byteLength % 3  // <-- CORREZIONE QUI
  var mainLength    = byteLength - byteRemainder
  var a, b, c, d
  var chunk
  // Main loop deals with bytes in chunks of 3
  for (var i = 0; i < mainLength; i = i + 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18 // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048)   >> 12 // 258048   = (2^6 - 1) << 12
    c = (chunk & 4032)     >>  6 // 4032     = (2^6 - 1) << 6
    d = chunk & 63               // 63       = 2^6 - 1
    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d]
  }
  // Deal with the remaining bytes and padding
  if (byteRemainder == 1) {
    chunk = bytes[mainLength]
    a = (chunk & 252) >> 2 // 252 = (2^6 - 1) << 2
    // Set the 4 least significant bits to zero
    b = (chunk & 3)   << 4 // 3   = 2^2 - 1
    base64 += encodings[a] + encodings[b] + '=='
  } else if (byteRemainder == 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1]
    a = (chunk & 64512) >> 10 // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008)  >>  4 // 1008  = (2^6 - 1) << 4
    // Set the 2 least significant bits to zero
    c = (chunk & 15)    <<  2 // 15    = 2^4 - 1
    base64 += encodings[a] + encodings[b] + encodings[c] + '='
  }
  
  return base64
}

export { testRunner };