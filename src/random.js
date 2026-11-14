export function seeded(text) {
    let hash = 2166136261;
    for (const ch of text) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619);
    return () => {
        hash = (hash + 0x6d2b79f5) | 0;
        let t = Math.imul(hash ^ (hash >>> 15), hash | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

