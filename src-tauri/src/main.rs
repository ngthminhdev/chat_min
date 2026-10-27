#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--import-zalo-cache") {
        if args.len() != 5 {
            eprintln!("cache_import_arguments");
            std::process::exit(2);
        }
        match chatmin_lib::import_zalo_cache(
            std::path::Path::new(&args[2]),
            std::path::Path::new(&args[3]),
            &args[4],
        ) {
            Ok(report) => println!("{report}"),
            Err(_) => {
                eprintln!("cache_import_failed");
                std::process::exit(1);
            }
        }
        return;
    }
    chatmin_lib::run()
}
