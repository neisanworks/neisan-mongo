import assert from "node:assert";
import mongo from "mongodb";

export function encode(item: unknown): any {
	if (typeof item !== "object" || item === null || item instanceof mongo.ObjectId) {
		return item;
	}

	if (Array.isArray(item)) {
		const encoded = item.map(encode);
		return encoded;
	}

	if (item instanceof Set) {
		const encoded = Array.from(item).map(encode);
		return { $$JSSet: encoded };
	}

	if (item instanceof Map) {
		const encoded = Array.from(item).map(encode);
		return { $$JSMap: encoded };
	}

	if (item instanceof Date) {
		return { $$JSDate: item.toISOString() };
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
		return decoded;
	}

	const entries: Array<[string, unknown]> = [];
	for (const [key, value] of Object.entries(item)) {
		if (key === "_id") {
			entries.push([key, value]);
			continue;
		}

		if (key === "$$JSSet") {
			assert(Array.isArray(value));
			const set = new Set(value.map(decode));
			return set;
		} else if (key === "$$JSMap") {
			assert(Array.isArray(value));
			const map = new Map(value.map(decode));
			return map;
		} else if (key === "$$JSDate") {
			assert(typeof value === "string");
			return new Date(value);
		}

		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			entries.push([key, decode(value)]);
		}

		entries.push([key, decode(value)]);
	}
	return Object.fromEntries(entries);
}
