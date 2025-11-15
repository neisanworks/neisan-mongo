import assert from "node:assert";
import type mongo from "mongodb";
import z from "zod/v4";

export abstract class Model<Schema extends z.ZodObject> {
	readonly _id!: mongo.ObjectId;
	private schema!: Schema;

	constructor(schema: Schema) {
		Object.defineProperties(this, {
			schema: {
				enumerable: false,
				configurable: true,
				writable: false,
				value: schema,
			},
		});
	}

	#configureProperty(target: object, key: string, schema: z.ZodType): void {
		assertIsObject(target);
		assert(schema instanceof z.ZodType, "schema in #configureObject is not ZodType");

		const descriptors = getDescriptor(target, key);
		const initial = descriptors.get("value");

		descriptors.delete("value");
		descriptors.delete("writable");
		descriptors.set("enumerable", true);
		descriptors.set("configurable", true);
		descriptors.set("get", () => {
			assert("__data__" in target);
			assert(target.__data__ instanceof ModelData);
			return target.__data__[key];
		});
		descriptors.set("set", (value: unknown) => {
			assert("__data__" in target);
			assert(target.__data__ instanceof ModelData);

			const parsed = schema.safeParse(value);
			if (!parsed.success) {
				parsed.error.issues.map((issue) => {
					Object.defineProperty(issue, "path", {
						value: [key],
					});
					return issue;
				});
				throw new z.ZodError(parsed.error.issues);
			}
			target.__data__[key] = parsed.data;

			const unwrapped = unwrapSchema(schema);
			if (unwrapped instanceof z.ZodObject) {
				this.#configureObject(target.__data__[key], schema);
			}
		});

		Object.defineProperty(target, key, Object.fromEntries(descriptors));

		if (initial !== undefined) {
			const setter = descriptors.get("set");
			assert(typeof setter === "function");
			setter.call(target, initial);
		}
	}

	#configureObject(target: object, schema: z.ZodType): void {
		const unwrapped = unwrapSchema(schema);

		assertIsObject(target, "target in #configureObject is not object");
		assert(
			unwrapped instanceof z.ZodObject,
			"unwrapped schema in #configureObject is not ZodObject",
		);

		Object.defineProperty(target, "__data__", {
			enumerable: false,
			configurable: false,
			writable: false,
			value: new ModelData(),
		});

		for (const [key, keyschema] of Object.entries(unwrapped.shape)) {
			assert(
				keyschema instanceof z.ZodType,
				"keyschema in #configureObject is not ZodType",
			);
			this.#configureProperty(target, key, keyschema);
		}
	}

	protected hydrate(data: Record<PropertyKey, unknown>) {
		this.#configureObject(this, this.schema);

		Object.assign(this, data);
		Object.defineProperty(this, "_id", {
			writable: false,
			configurable: false,
			enumerable: true,
			value: data._id,
		});
		// @ts-expect-error: Must use delete keyword to remove schema from model;
		delete this.schema;
	}

	toJSON(): z.core.output<Schema> {
		return Object.fromEntries(
			Object.entries(this).filter(([k]) => k !== "_id"),
		) as z.core.output<Schema>;
	}
}

// biome-ignore lint: Using Object instead of object to assert item !== null
export function assertIsObject(item: unknown, message?: string): asserts item is Object {
	assert(typeof item === "object" && item !== null && !Array.isArray(item), message);
}

export function unwrapSchema(schema: z.ZodType): z.ZodType {
	let result = schema;
	while ("unwrap" in result && typeof result.unwrap === "function") {
		result = result.unwrap();
	}
	return result;
}

export class ModelData {
	[key: string]: any;
}

export function getDescriptor(
	target: object,
	key: PropertyKey,
): Map<keyof PropertyDescriptor, unknown> {
	const descriptors = new Map<keyof PropertyDescriptor, unknown>();
	Object.entries(Object.getOwnPropertyDescriptor(target, key) ?? {}).forEach(([k, v]) => {
		descriptors.set(k as keyof PropertyDescriptor, v);
	});
	return descriptors;
}
