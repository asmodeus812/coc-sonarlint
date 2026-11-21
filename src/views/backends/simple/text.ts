/**
 * Terminal cell widths: combining and zero width characters take 0 cells, CJK and emoji 2, everything else 1.
 * Strings are measured and cut by cells, never by UTF-16 units.
 */

const ZERO: number[][] = [
    [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a], [0x064b, 0x065f], [0x0e31, 0x0e31],
    [0x0e34, 0x0e3a], [0x0e47, 0x0e4e], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x200b, 0x200f], [0x202a, 0x202e],
    [0x2060, 0x2064], [0x20d0, 0x20ff], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f], [0xfeff, 0xfeff], [0xe0100, 0xe01ef],
];
const WIDE: number[][] = [
    [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
    [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
    [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
    [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
    [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
    [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x303e],
    [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
    [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x18aff],
    [0x1b000, 0x1b2ff], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a],
    [0x1f200, 0x1f2ff], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f9ff],
    [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
];

function inRanges(cp: number, ranges: number[][]): boolean {
    let lo = 0;
    let hi = ranges.length - 1;
    let found = false;
    while (!found && lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cp < ranges[mid][0]) {
            hi = mid - 1;
        } else if (cp > ranges[mid][1]) {
            lo = mid + 1;
        } else {
            found = true;
        }
    }
    return found;
}

/** Cells of one code point. */
function cpWidth(cp: number): number {
    let w = 1;
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || inRanges(cp, ZERO)) {
        w = 0;
    } else if (cp >= 0x1100 && inRanges(cp, WIDE)) {
        w = 2;
    }
    return w;
}

/** Cells of a string. */
export function displayWidth(s: string): number {
    let w = 0;
    for (const ch of s) {
        w += cpWidth(ch.codePointAt(0) as number);
    }
    return w;
}

/**
 * Splits `s` into pieces of at most `width` cells (a wide character never splits; a piece holds at least one
 * character). Returns UTF-16 end offsets of the pieces.
 */
export function cutByCells(s: string, width: number): number[] {
    const ends: number[] = [];
    let used = 0;
    let i = 0;
    for (const ch of s) {
        const w = cpWidth(ch.codePointAt(0) as number);
        if (used > 0 && used + w > width) {
            ends.push(i);
            used = 0;
        }
        used += w;
        i += ch.length;
    }
    ends.push(s.length);
    return ends;
}

/** `n` spaces (none when `n` is not positive). */
export function spaces(n: number): string {
    return n > 0 ? " ".repeat(n) : "";
}
