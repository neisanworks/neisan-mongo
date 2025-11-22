import assert from "node:assert";

export function encode(item: unknown): any {
	if (typeof item !== "object" || item === null) {
		return item;
	}

	if (Array.isArray(item)) {
		const encoded = item.map(encode);
		if (process.env.NODE_ENV !== "production") {
			console.log({ method: "encode", input: item, output: encoded });
		}
		return encoded;
	}

	if (item instanceof Set) {
		const encoded = Array.from(item).map(encode);
		if (process.env.NODE_ENV !== "production") {
			console.log({ method: "encode", input: item, output: encoded });
		}
		return { $$JSSet: encoded };
	}

	if (item instanceof Map) {
		const encoded = Array.from(item).map(encode);
		if (process.env.NODE_ENV !== "production") {
			console.log({ method: "encode", input: item, output: encoded });
		}
		return { $$JSMap: encoded };
	}

	const entries: Array<[string, unknown]> = [];
	for (const [key, value] of Object.entries(item)) {
		entries.push([key, encode(value)]);
	}
	return Object.fromEntries(entries);
}

export function decode(item: unknown): any {
	if (typeof item !== "object" || item === null) {
		return item;
	}

	if (Array.isArray(item)) {
		const decoded = item.map(decode);
		if (process.env.NODE_ENV !== "production") {
			console.log({ method: "decode", input: item, output: decoded });
		}
		return decoded;
	}

	const entries: Array<[string, unknown]> = [];
	for (const [key, value] of Object.entries(item)) {
        if (process.env.NODE_ENV !== "production") {
            console.log({ method: "decode", key, value });
        }

		if (key === "_id") {
            if (process.env.NODE_ENV !== "production") {
                console.log({ method: "decode", input: value, output: value });
            }
			entries.push([key, value]);
			continue;
		}

		if (key === "$$JSSet") {
			assert(Array.isArray(value));
			const set = new Set(value.map(decode));
            if (process.env.NODE_ENV !== "production") {
                console.log({ method: "decode", input: value, output: set });
            }
            return set;
		} else if (key === "$$JSMap") {
			assert(Array.isArray(value));
			const map = new Map(value.map(decode));
            if (process.env.NODE_ENV !== "production") {
                console.log({ method: "decode", input: value, output: map });
            }
            return map;
		}

		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            if (process.env.NODE_ENV !== "production") {
                console.log({ method: "decode", input: value, output: decode(value) });
            }
			entries.push([key, decode(value)]);
		}

		entries.push([key, decode(value)]);
	}
	return Object.fromEntries(entries);
}
