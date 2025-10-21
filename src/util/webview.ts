/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";
import { FloatFactory, FloatWinConfig, HighlightItem, nvim, workspace } from "coc.nvim";
import stringWidth from "string-width";

const entityMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "/": "&#x2F;",
    "`": "&#x60;",
    "=": "&#x3D;"
};

function _luma(hex: string): number {
    const rgb = _hexToRgb3(hex);
    if (!rgb) return 0.5;
    const [r, g, b] = rgb.map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function _lighten(hex: string, t = 0.08): string {
    const rgb = _hexToRgb3(hex);
    if (!rgb) return hex;
    const [r, g, b] = rgb;
    return _rgbToHex3(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}
function _darken(hex: string, t = 0.08): string {
    const rgb = _hexToRgb3(hex);
    if (!rgb) return hex;
    const [r, g, b] = rgb;
    return _rgbToHex3(r * (1 - t), g * (1 - t), b * (1 - t));
}

async function _getGroupBgHex(group: string): Promise<string | undefined> {
    const v = (await nvim.eval(`synIDattr(hlID("${group}"), "bg#")`)) as string;
    return /^#[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : undefined;
}

function _hexToRgb3(hex: string): [number, number, number] | null {
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const h = m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Back to "#RRGGBB"
function _rgbToHex3(r: number, g: number, b: number): string {
    const cl = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    return (
        "#" +
        [cl(r), cl(g), cl(b)]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase()
    );
}

export async function createDefaultRenderingHighlights() {
    [
        "hi def link Header1 CocMarkdownHeader",
        "hi def link Header2 CocMarkdownHeader",
        "hi def link Header3 CocMarkdownHeader",
        "hi def link Header4 CocMarkdownHeader",
        "hi def link Header5 CocMarkdownHeader",
        "hi def link Header6 CocMarkdownHeader",

        "hi def link LinkText CocInfoSign",
        "hi def link LinkUrl CocMarkdownLink",

        "hi def link InlineCode Nonde",
        "hi def link CodeBackground None",

        "hi def link SectionSeparator WinSeparator",
        "hi def link ListBullet Special",
        "hi def link Rule Comment",
        "hi def link TableTitle Special",
        "hi def link TableHeader Title",
        "hi def link TableBorder Comment",
        "hi def link Badge Special",

        "hi def link BlockQuoteBorder Comment",
        "hi def link BlockQuote Comment",
        "hi def link FigureCaption Comment",

        "hi def link HLJSKeyword Keyword",
        "hi def link HLJSTitle Function",
        "hi def link HLJSFunction Function",
        "hi def link HLJSParams Identifier",
        "hi def link HLJSLiteral Type",
        "hi def link HLJSNumber Number",
        "hi def link HLJSString String",
        "hi def link HLJSComment Comment",
        "hi def link HLJSBuiltIn Identifier",
        "hi def link HLJSOperator Operator",
        "hi def link HLJSPunctuation Delimiter"
    ].forEach(async (hl) => await nvim.command(hl));
}

export async function createBlendingBackgroundHighlight(newGroupName = "CodeBackground", sourceGroupName?: string): Promise<void> {
    const candidates = ["CocFloating", "NormalFloat", "Pmenu", "Normal"];

    let base: string | undefined;
    if (sourceGroupName) {
        await _getGroupBgHex(sourceGroupName);
    } else {
        for (const g of candidates) {
            base = await _getGroupBgHex(g);
            if (base) break;
        }
    }

    if (!base) {
        // Final fallback using &background
        const bg = (await nvim.eval("&background")) as string;
        base = bg === "light" ? "#FFFFFF" : "#1E1E1E";
    }

    // If background is dark → lighten a bit; if light → darken a bit
    const L = _luma(base);
    const shade = L < 0.5 ? _lighten(base, 0.03) : _darken(base, 0.03);

    // Define the group with *only* guibg
    await nvim.command(`hi! ${newGroupName} guibg=${shade}`);
}

export function escapeHtml(str: string) {
    return String(str).replace(/[&<>"'/`=]/g, function (s) {
        return entityMap[s];
    });
}

export function escapeMd(s: string): string {
    // escape the usual markdown specials in inline contexts
    return s.replace(/[\\`*_{}\[\]()#+\-.!|]/g, "\\$&");
}

export function clean(str: string) {
    return capitalizeName(str.toLowerCase().split("_").join(" "));
}

export function capitalizeName(name: string) {
    return name.replace(/\b(\w)/g, (s) => s.toUpperCase());
}

export function visualWidth(s: string): number {
    // strip ANSI (if any)
    s = s.replace(/\x1B\[[0-9;]*m/g, "");
    // expand tabs as 2 spaces (tweak if you want 4)
    s = s.replace(/\t/g, "  ");
    // simplistic wcwidth: treat wide chars as width 2 (optional)
    let w = 0;
    for (const ch of s) {
        const code = ch.codePointAt(0)!;
        // crude “is wide?” heuristic (CJK range); if you need precision, bring a wcwidth lib
        const wide =
            code >= 0x1100 &&
            (code <= 0x115f || // Hangul Jamo
                code === 0x2329 ||
                code === 0x232a ||
                (code >= 0x2e80 && code <= 0xa4cf) ||
                (code >= 0xac00 && code <= 0xd7a3) ||
                (code >= 0xf900 && code <= 0xfaff) ||
                (code >= 0xfe10 && code <= 0xfe6f) ||
                (code >= 0xff00 && code <= 0xff60) ||
                (code >= 0xffe0 && code <= 0xffe6));
        w += wide ? 2 : 1;
    }
    return w;
}

export function calculateFloatConfig(text: string, maxColsPercent = 0.85, maxRowsPercent = 0.75) {
    const editorWidth = workspace.env.columns;
    const editorHeight = workspace.env.lines;

    let maxWidth = 0;
    let currentWidth = 0;
    let lineCount = 0;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === "\n") {
            lineCount++;
            if (currentWidth > maxWidth) maxWidth = currentWidth;
            currentWidth = 0;
        } else if (ch === "\r") {
            // handle \r\n
            if (text[i + 1] === "\n") i++;
            lineCount++;
            if (currentWidth > maxWidth) maxWidth = currentWidth;
            currentWidth = 0;
        } else {
            // Use stringWidth for proper terminal width
            currentWidth += stringWidth(ch);
        }
    }

    if (currentWidth > 0 || text.length === 0) lineCount++;
    if (currentWidth > maxWidth) maxWidth = currentWidth;

    const maxFloatWidth = Math.floor(editorWidth * maxColsPercent);
    const floatWidth = Math.min(maxWidth, maxFloatWidth);

    const maxFloatHeight = Math.floor(editorHeight * maxRowsPercent);
    const floatHeight = Math.min(lineCount, maxFloatHeight);

    // Calculate top-left position to center properly
    const top = Math.floor((editorHeight - floatHeight) / 2);
    const left = Math.floor((editorWidth - floatWidth) / 2);

    return {
        position: "fixed",
        border: true,
        rounded: true,
        highlight: "CocFloating",
        cursorline: false,
        borderhighlight: "CocFloatBorder",
        shadow: true,
        close: false,
        focusable: true,
        preferTop: false,
        autoHide: true,
        modes: ["n"],
        top,
        left,
        maxWidth: floatWidth,
        maxHeight: floatHeight
    } as FloatWinConfig;
}

export async function showWebView(factory: FloatFactory, content: string, highlights?: HighlightItem[]) {
    await factory.show([{ content, highlights, filetype: "text" }], calculateFloatConfig(content));
}
