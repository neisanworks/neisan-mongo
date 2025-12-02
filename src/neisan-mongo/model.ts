import assert from "node:assert";
import type mongo from "mongodb";
import type z from "zod/v4";
import type { Data, JSONData } from "../types.js";
import type { RelationshipRecord } from "./client.js";

export abstract class Model<Schema extends z.ZodObject> {
		[key: PropertyKey]: any;
		_id!: mongo.ObjectId;

		constructor() {
			if ("__relationships__" in this && this.__relationships__ instanceof Map) {
				Object.defineProperty(this, "__relationships__", {
					writable: false,
					configurable: false,
					enumerable: false,
					value: this.__relationships__,
				});
				assert(
					"__relationships__" in this,
					"this.__relationships__ should be a property",
				);
				assert(
					this.__relationships__ instanceof Map,
					"this.__relationships__ should be a Map",
				);

				for (const key of this.__relationships__.keys()) {
					Object.defineProperty(
						this,
						key,
						Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), key) ?? {},
					);
				}
			}
		}

		protected hydrate(data: Data) {
			Object.assign(this, data);
		}

		/**
		 * Populate a relationship with the associated model, given the key.
		 * @param key The key of the relationship to populate.
		 * @returns
		 * A promise that resolves to the populated model if it exists,
		 * or null if it does not.
		 * @example
		 * const post = await Posts.findOne(id)
		 * await post.populate("author");
		 * console.log(post.author.username); // prints the username of the author
		 */
		async populate<K extends keyof z.infer<Schema>>(
			key: K,
		): Promise<Exclude<this[K], mongo.ObjectId> | null>;
		/**
		 * Populate multiple relationships with the associated models, given the keys.
		 * @param keys The keys of the relationships to populate.
		 * @returns A promise that resolves when all relationships have been populated.
		 * @example
		 * const post = await Posts.findOne(id)
		 * await post.populate(["author"]);
		 * console.log(post.author.username); // prints the username of the author
		 */
		async populate<K extends keyof z.infer<Schema>>(keys: Array<K>): Promise<undefined>;
		async populate<K extends keyof z.infer<Schema>>(
			keys: K | Array<K>,
		): Promise<Exclude<this[K], mongo.ObjectId> | null | undefined> {
			if (!("__relationships__" in this) || !(this.__relationships__ instanceof Map)) {
				return null;
			}

			if (Array.isArray(keys)) {
				for (const key of keys) {
					await this.populate(key);
				}
				return;
			}

			if (!this.__relationships__.has(keys)) return null;
			const record: RelationshipRecord<any, any> = this.__relationships__.get(keys);
			if (record.model) return record.model;
			if (!record.relationship._id) return null;
			const result = await record.relationship.populate();
			record.model = result;
			this.__relationships__.set(keys, record);
			return result;
		}

		/**
		 * Returns a JSON representation of the model.
		 * @note
		 * Relationships are replaced with the associated model's `_id`
		 * @example
		 * const post = await Posts.findOne(id)
		 * const json = post.toJSON()
		 * console.log(json); // prints the JSON representation of the post
		 * @returns A JSON representation of the model.
		 */
		toJSON(): JSONData<Schema> {
			let record: Map<string, RelationshipRecord<any, any>> | undefined;
			if ("__relationships__" in this && this.__relationships__ instanceof Map) {
				record = this.__relationships__;
			}

			const data: Data = {};
			for (const [key, value] of Object.entries(this)) {
				if (record?.has(key)) {
					data[key] = record.get(key)?.relationship._id ?? null;
					continue;
				}
				data[key] = value;
			}
			return data as JSONData<Schema>;
		}
	}
