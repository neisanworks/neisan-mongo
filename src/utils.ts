import assert from "node:assert";
import mongo from "mongodb";
import type { Data } from "./types.js";

export function EJSONCompatible(item: unknown): boolean {
	if (["function", "undefined", "symbol"].includes(typeof item)) return false;

	if (typeof item !== "object" || item === null) return true;

	if (
		item instanceof mongo.ObjectId ||
		item instanceof Date ||
		item instanceof RegExp ||
		item instanceof Uint8Array ||
		Buffer.isBuffer(item)
	) {
		return true;
	}

	return false;
}

export function encode(item: unknown): any {
	if (EJSONCompatible(item)) {
		const serialized = mongo.BSON.EJSON.stringify(item);
		return mongo.BSON.EJSON.parse(serialized);
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

	assert(
		typeof item === "object" && item !== null,
		"Item in `encode` should be an object to iterate over entries",
	);
	const entries: Array<[string, unknown]> = [];
	for (const [key, value] of Object.entries(item)) {
		entries.push([key, encode(value)]);
	}
	const result = Object.fromEntries(entries);
	return result;
}

export function decode(item: unknown): any {
	if (EJSONCompatible(item)) {
		return item;
	}

	if (Array.isArray(item)) {
		return item.map(decode);
	}

	assert(
		typeof item === "object" && item !== null,
		"Item in `encode` should be an object to iterate over entries",
	);
	const entries: Array<[string, unknown]> = [];
	for (const [key, value] of Object.entries(item)) {
		if (key === "_JSSet") {
			assert(Array.isArray(value));
			return new Set(value.map(decode));
		} else if (key === "_JSMap") {
			assert(Array.isArray(value));
			return new Map(value.map(decode));
		}

		if (EJSONCompatible(value)) {
			entries.push([key, value]);
			continue;
		}

		entries.push([key, decode(value)]);
	}

	return Object.fromEntries(entries);
}

export function RecordLike(item: unknown): item is Record<string, any> {
	return typeof item === "object" && item !== null && !Array.isArray(item);
}

export const equal = (a: unknown, b: unknown): boolean => {
	try {
		assert.deepStrictEqual(a, b);
		return true;
	} catch {
		return false;
	}
};

type PushOperator = ({
	[key in mongo.KeysOfAType<Data, ReadonlyArray<any>>]?:
		| mongo.Flatten<Data[key]>
		| mongo.ArrayOperator<Array<mongo.Flatten<Data[key]>>>;
} & mongo.NotAcceptedFields<Data, ReadonlyArray<any>>) & {
	[key: string]: mongo.ArrayOperator<any> | any;
};

export class UpdateFilter implements mongo.UpdateFilter<Record<string, any>> {
	[key: string]: any;
	$addToSet: mongo.SetFields<Record<string, any>> = {};
	$bit:
		| Record<string, { and: mongo.IntegerType }>
		| Record<string, { or: mongo.IntegerType }>
		| Record<string, { xor: mongo.IntegerType }> = {};
	$currentDate: Record<string, true> | Record<string, { $type: "date" | "timestamp" }> =
		{};
	$inc: Record<string, mongo.NumericType | undefined> = {};
	$max: Record<string, any> = {};
	$min: Record<string, any> = {};
	$mul: Record<string, mongo.NumericType | undefined> = {};
	$pop: Record<string, 1> | Record<string, -1> = {};
	$pull: mongo.PullOperator<Record<string, any>> = {};
	$pullAll: mongo.PullAllOperator<Record<string, any>> = {};
	$push: PushOperator = {};
	$rename: Record<string, string> = {};
	$set: Record<string, any> = {};
	$setOnInsert: Record<string, any> = {};
	$unset: Record<string, any> = {};

	get parse(): mongo.UpdateFilter<Record<string, any>> {
		const entries = Object.entries(this).filter(
			([_, value]) => Object.keys(value).length > 0,
		);
		entries.forEach(([_, value]) => {
			if ('_id' in value) delete value._id
		})
		return Object.fromEntries(entries);
	}
}

export const changes = (prefix: string, a: unknown, b: unknown): UpdateFilter => {
	const diff = new UpdateFilter();

	if (b === undefined) {
		assert.notStrictEqual(prefix, "");
		diff.$unset[prefix] = "";
		return diff;
	}

	if (
		EJSONCompatible(a) ||
		EJSONCompatible(b) ||
		Array.isArray(b) ||
		b instanceof Set ||
		b instanceof Map ||
		typeof b === 'bigint'
	) {
		if (equal(a, b)) return diff;

		assert.notStrictEqual(prefix, "");

		if (b instanceof Set) {
			if (!(a instanceof Set)) {
				diff.$set[prefix] = encode(b);
				return diff;
			}

			const aEntries = Array.from(a);
			const bEntries = Array.from(b);
			for (let i = 0; i < Math.max(a.size, b.size); i++) {
				if (!equal(aEntries.at(i), bEntries.at(i))) {
					const key = `${prefix}._JSSet`;
					diff.$push[key] = {
						$each: bEntries.slice(i).map(encode),
						$position: i,
						$slice: b.size,
					};
					return diff;
				}
			}
		} else if (b instanceof Map) {
			if (!(a instanceof Map)) {
				diff.$set[prefix] = encode(b);
				return diff;
			}

			const aEntries = Array.from(a);
			const bEntries = Array.from(b);
			for (let i = 0; i < Math.max(a.size, b.size); i++) {
				if (!equal(aEntries.at(i), bEntries.at(i))) {
					const key = `${prefix}._JSMap`;
					diff.$push[key] = {
						$each: bEntries.slice(i).map(encode),
						$position: i,
						$slice: b.size,
					};
					return diff;
				}
			}
		} else if (Array.isArray(b)) {
			if (!Array.isArray(a)) {
				diff.$set[prefix] = b.map(encode);
				return diff;
			}

			for (let i = 0; i < Math.max(a.length, b.length); i++) {
				if (!equal(a.at(i), b.at(i))) {
					diff.$push[prefix] = {
						$each: b.slice(i).map(encode),
						$position: i,
						$slice: b.length,
					};
					return diff;
				}
			}
		}

		diff.$set[prefix] = encode(b);
		return diff;
	}

	if (["function", "symbol"].includes(typeof b)) {
		return diff;
	}

	if (typeof a !== typeof b) {
		assert.notStrictEqual(prefix, "");
		diff.$set[prefix] = encode(b);
		return diff;
	}

	assert(RecordLike(a));
	assert(RecordLike(b));

	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);

	const path = (k: string) => (prefix ? `${prefix}.${k}` : k);

	for (const k of aKeys) {
		if (!bKeys.includes(k)) {
			diff.$unset[path(k)] = "";
		}
	}

	for (const [k, v] of Object.entries(b)) {
		const vChanges = changes(path(k), a[k], v);
		for (const [oper, values] of Object.entries(vChanges.parse)) {
			Object.assign(diff[oper], values);
		}
	}

	return diff;
};
