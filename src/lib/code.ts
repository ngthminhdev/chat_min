// Syntax colours for ``` blocks (Telegram sends the language on PreCode; Google Chat never
// does, so an unlabelled block is auto-detected among the languages below and only coloured
// when highlight.js is fairly sure).
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGS: Record<string, unknown> = { bash, c, cpp, csharp, css, dart, go, java, javascript, json, kotlin, php, python, ruby, rust, sql, swift, typescript, xml, yaml };
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang as Parameters<typeof hljs.registerLanguage>[1]);
const ALIAS: Record<string, string> = { js: "javascript", ts: "typescript", py: "python", sh: "bash", shell: "bash", zsh: "bash", "c++": "cpp", cs: "csharp", rb: "ruby", rs: "rust", yml: "yaml", html: "xml", golang: "go", jsx: "javascript", tsx: "typescript" };

/** HTML for a code block: escaped and coloured; `lang` is the name actually used ("" when plain). */
export function highlight(code: string, lang: string): { html: string; lang: string } {
  const name = ALIAS[lang.toLowerCase()] ?? lang.toLowerCase();
  if (name && hljs.getLanguage(name)) return { html: hljs.highlight(code, { language: name, ignoreIllegals: true }).value, lang: name };
  // ponytail: auto-detect only for blocks with a few lines; one-liners stay plain
  if (code.split("\n").length >= 3) {
    const r = hljs.highlightAuto(code, Object.keys(LANGS));
    if (r.relevance >= 8 && r.language) return { html: r.value, lang: r.language };
  }
  return { html: code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), lang: "" };
}
