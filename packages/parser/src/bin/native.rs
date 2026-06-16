// Binario de iteracao: roda o parser nativo (sem wasm) para validar o JSON.
// Uso: native <entrada.dem> [saida.json] [frameRate]
use std::fs;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("uso: native <entrada.dem> [saida.json] [frameRate]");
        std::process::exit(1);
    }
    let bytes = fs::read(&args[1]).expect("ler demo");
    let frame_rate: u32 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(8);
    match cs2_demo_parser_wasm::parse_all(&bytes, frame_rate) {
        Ok((json, voice)) => {
            if let Some(out) = args.get(2) {
                fs::write(out, &json).expect("escrever saida");
                // Blob de voz ao lado do JSON: <saida>.voice
                let voice_out = format!("{out}.voice");
                fs::write(&voice_out, &voice).expect("escrever voz");
                eprintln!(
                    "[native] ok -> {} ({} bytes) | voz -> {} ({} bytes)",
                    out, json.len(), voice_out, voice.len()
                );
            } else {
                println!("{}", &json[..json.len().min(2000)]);
                eprintln!("[native] blob de voz: {} bytes", voice.len());
            }
        }
        Err(e) => {
            eprintln!("[native] erro: {}", e);
            std::process::exit(1);
        }
    }
}
