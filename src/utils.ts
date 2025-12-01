import assert from "node:assert";
import mongo from "mongodb";

export function encode(item: unknown): any {
	if (typeof item !== "object" || item === null || item instanceof mongo.ObjectId) {
		return item;
	}

	if (Array.isArray(item)) {
		return item.map(encode);
	}

	if (item instanceof Set) {
		const encoded = Array.from(item).map(encode);
		return { _JSSet: encoded };
	}

	if (item instanceof Map) {
		const encoded = Array.from(item).map(encode);
		return { _JSMap: encoded };
	}

	if (item instanceof Date) {
		return { _JSDate: item.toLocaleString() };
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
		return item.map(decode);
	}

	const entries: Array<[string, unknown]> = [];
	for (const [key, value] of Object.entries(item)) {
		if (key === "_id") {
			entries.push([key, value]);
			continue;
		}

		if (key === "_JSSet") {
			assert(Array.isArray(value));
			return new Set(value.map(decode));
		} else if (key === "_JSMap") {
			assert(Array.isArray(value));
			return new Map(value.map(decode));
		} else if (key === "_JSDate") {
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
