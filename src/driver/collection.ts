import assert from "node:assert";
import mongo from "mongodb";
import z from "zod/v4";
import type {
	CollectionModel,
	CollectionParameters,
	CountOptions,
	InsertResult,
	ModelConstructor,
	ModelUpdater,
	QueryPredicate,
	SchemaError,
	UpdateManyResult,
	UpdateResult,
} from "../types.js";
import { FindCursor } from "./cursor.js";

export class MongoCollection<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> {
	readonly collection!: mongo.Collection;
	private readonly schema: Schema;
	readonly model!: ModelConstructor<Schema, Instance>;
	private readonly unique: Array<keyof z.core.output<Schema>>;

	constructor(db: mongo.Db, params: CollectionParameters<Schema, Instance>) {
		const name = params.name;
		this.schema = params.schema;
		this.unique = params.unique ?? [];
		Object.defineProperty(this, "collection", {
			writable: false,
			configurable: false,
			enumerable: false,
			value: db.collection(name, params),
		});
		Object.defineProperty(this, "model", {
			writable: false,
			configurable: false,
			enumerable: false,
			value: params.model,
		});
	}

	#schemaFailure(failure: z.ZodError): {
		acknowledged: false;
		errors: Partial<Record<keyof z.infer<Schema>, string>>;
	} {
		const errors: Partial<Record<keyof z.infer<Schema>, string>> = {};
		z.treeifyError(failure, (issue) => {
			const path = issue.path.at(0);
			if (path) errors[path as keyof z.infer<Schema>] = issue.message;
		});
		return { acknowledged: false, errors };
	}

	#rejectFailure(): {
		acknowledged: false;
		errors: { general: string };
	} {
		return {
			acknowledged: false,
			errors: { general: "Rejected By Collection" },
		};
	}

	#uniqueFailure(key: keyof z.infer<Schema>): {
		acknowledged: false;
		errors: SchemaError<Schema>;
	} {
		return {
			acknowledged: false,
			errors: { [key]: `${String(key)} must be unique` } as SchemaError<Schema>,
		};
	}

	encode(item: any): any {
		if (
			item instanceof mongo.ObjectId ||
			typeof item !== "object" ||
			(item === null && !Array.isArray(item))
		) {
			return item;
		}

		if (Array.isArray(item)) {
			return item.map(this.encode);
		} else if (item instanceof Set) {
			return { $$JSSet: Array.from(item).map(this.encode) };
		} else if (item instanceof Map) {
			return { $$JSMap: Array.from(item).map(this.encode) };
		}

		const entries: Array<[string, unknown]> = [];
		for (const [key, value] of Object.entries(item)) {
			entries.push([key, this.encode(value)]);
		}
		return Object.fromEntries(entries);
	}

	decode(item: any): any {
		if (
			item instanceof mongo.ObjectId ||
			typeof item !== "object" ||
			(item === null && !Array.isArray(item))
		) {
			return item;
		}

		if (Array.isArray(item)) {
			return item.map(this.decode);
		}

		const entries: Array<[string, unknown]> = [];
		for (const [key, value] of Object.entries(item)) {
			if (key === "_id") {
				entries.push([key, value]);
				continue;
			}

			if (key === "$$JSSet") {
				assert(Array.isArray(value));
				return new Set(value.map(this.decode));
			} else if (key === "$$JSMap") {
				assert(Array.isArray(value));
				return new Map(value.map(this.decode));
			}

			if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				entries.push([key, this.decode(value)]);
			}

			entries.push([key, this.decode(value)]);
		}
		return Object.fromEntries(entries);
	}

	async insert(
		doc: z.core.input<Schema>,
		options?: mongo.InsertOneOptions,
	): Promise<InsertResult<Schema, Instance>> {
		const parse = await this.schema.safeParseAsync(doc);
		if (!parse.success) {
			return this.#schemaFailure(parse.error);
		}
		const encoded = this.encode(parse.data);

		for (const unique of this.unique) {
			const query = { [unique]: encoded[unique] };
			if (await this.collection.findOne(query)) {
				return this.#uniqueFailure(unique);
			}
		}

		const result = await this.collection.insertOne(encoded, options);
		if (!result.acknowledged) {
			return this.#rejectFailure();
		}

		return {
			acknowledged: true,
			model: new this.model({ ...parse.data, _id: result.insertedId }),
		};
	}

	find(
		search?: Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		options?: mongo.FindOptions,
	): FindCursor<Schema, Instance> {
		return new FindCursor(this, search, options);
	}

	async findOne(
		id: mongo.ObjectId,
		options?: mongo.FindOneOptions,
	): Promise<Instance | null>;
	async findOne(
		filter: Partial<z.infer<Schema>>,
		options?: mongo.FindOneOptions,
	): Promise<Instance | null>;
	async findOne(
		predicate: QueryPredicate<Schema, Instance>,
		options?: mongo.FindOneOptions,
	): Promise<Instance | null>;
	async findOne(
		search: mongo.ObjectId | Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		options?: mongo.FindOneOptions,
	): Promise<Instance | null> {
		if (typeof search === "object") {
			const match = await this.collection.findOne(this.encode(search), options);
			if (match === null) return null;
			try {
				return new this.model(this.decode(match));
			} catch {
				return null;
			}
		}

		for await (const model of this.find(search, options)) {
			return model;
		}
		return null;
	}

	async updateOne(
		id: mongo.ObjectId,
		partial: Partial<z.infer<Schema>>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>>;
	async updateOne(
		id: mongo.ObjectId,
		updater: ModelUpdater<Schema, Instance>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>>;
	async updateOne(
		filter: Partial<z.infer<Schema>>,
		partial: Partial<z.infer<Schema>>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>>;
	async updateOne(
		filter: Partial<z.infer<Schema>>,
		updater: ModelUpdater<Schema, Instance>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>>;
	async updateOne(
		predicate: QueryPredicate<Schema, Instance>,
		partial: Partial<z.infer<Schema>>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>>;
	async updateOne(
		predicate: QueryPredicate<Schema, Instance>,
		updater: ModelUpdater<Schema, Instance>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>>;
	async updateOne(
		search: mongo.ObjectId | Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		update: Partial<z.infer<Schema>> | ModelUpdater<Schema, Instance>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>> {
		const updater = async (model: Instance) => {
			if (typeof update === "function") {
				await update(model);
				return;
			}
			Object.assign(model, update);
		};

		try {
			const model =
				search instanceof mongo.ObjectId
					? await this.findOne(search, options)
					: typeof search === "function"
						? await this.findOne(search, options)
						: await this.findOne(search, options);
			if (model === null) {
				return { acknowledged: false, errors: { general: "Document Not Found" } };
			}

			await updater(model);
			const encoded = this.encode(model.toJSON());
			for (const unique of this.unique) {
				const conflict = await this.findOne({ [unique]: encoded[unique] } as Partial<
					z.infer<Schema>
				>);
				if (conflict) {
					console.log({ model, conflict, [unique]: encoded[unique] });
					return this.#uniqueFailure(unique);
				}
			}

			const updated = await this.collection.findOneAndUpdate(
				{ _id: model._id },
				{ $set: encoded },
				{ ...options },
			);
			if (updated === null) return this.#rejectFailure();

			return { acknowledged: true, model };
		} catch (error) {
			if (error instanceof z.ZodError) {
				return this.#schemaFailure(error);
			}
			return this.#rejectFailure();
		}
	}

	async deleteOne(
		id: mongo.ObjectId,
		options?: mongo.DeleteOptions,
	): Promise<Instance | null>;
	async deleteOne(
		filter: Partial<z.infer<Schema>>,
		options?: mongo.DeleteOptions,
	): Promise<Instance | null>;
	async deleteOne(
		predicate: QueryPredicate<Schema, Instance>,
		options?: mongo.DeleteOptions,
	): Promise<Instance | null>;
	async deleteOne(
		search: mongo.ObjectId | Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		options?: mongo.DeleteOptions,
	): Promise<Instance | null> {
		const model =
			search instanceof mongo.ObjectId
				? await this.findOne(search, options)
				: typeof search === "function"
					? await this.findOne(search, options)
					: await this.findOne(search, options);
		if (model === null) return null;

		const deleted = await this.collection.deleteOne({ _id: model._id }, options);
		if (!deleted.acknowledged) return null;

		return model;
	}

	async findMany(
		partial: Partial<z.infer<Schema>>,
		options?: mongo.FindOptions,
	): Promise<Array<Instance> | null>;
	async findMany(
		predicate: QueryPredicate<Schema, Instance>,
		options?: mongo.FindOptions,
	): Promise<Array<Instance> | null>;
	async findMany(
		search: Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		options?: mongo.FindOptions,
	): Promise<Array<Instance> | null> {
		const results: Array<Instance> = [];
		for await (const model of this.find(search, options)) {
			results.push(model);
		}
		return results.length > 0 ? results : null;
	}

	async updateMany(
		partial: Partial<z.infer<Schema>>,
		update: Partial<z.infer<Schema>>,
		options?: mongo.FindOptions,
	): Promise<UpdateManyResult<Schema, Instance>>;
	async updateMany(
		predicate: QueryPredicate<Schema, Instance>,
		update: Partial<z.infer<Schema>>,
		options?: mongo.FindOptions,
	): Promise<UpdateManyResult<Schema, Instance>>;
	async updateMany(
		partial: Partial<z.infer<Schema>>,
		updater: ModelUpdater<Schema, Instance>,
		options?: mongo.FindOptions,
	): Promise<UpdateManyResult<Schema, Instance>>;
	async updateMany(
		predicate: QueryPredicate<Schema, Instance>,
		updater: ModelUpdater<Schema, Instance>,
		options?: mongo.FindOptions,
	): Promise<UpdateManyResult<Schema, Instance>>;
	async updateMany(
		search: Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		update: Partial<z.infer<Schema>> | ModelUpdater<Schema, Instance>,
		options?: mongo.FindOptions,
	): Promise<UpdateManyResult<Schema, Instance>> {
		if (typeof update === "object") {
			for (const unique of this.unique) {
				if (unique in update) return this.#uniqueFailure(unique);
			}
		}

		const updater = async (model: Instance) => {
			if (typeof update === "function") {
				await update(model);
			} else {
				Object.assign(model, update);
			}
		};

		const models: Array<Instance> = [];
		for await (const model of this.find(search, options)) {
			try {
				await updater(model);
				if (typeof update === "function") {
					for (const unique of this.unique) {
						const encoded = this.encode({ [unique]: model[unique] });
						if (await this.findOne(encoded)) {
							return this.#uniqueFailure(unique);
						}
					}
				}
				const result = await this.updateOne(model._id, this.encode(model.toJSON()));
				if (result.acknowledged) models.push(model);
			} catch (error) {
				if (error instanceof z.ZodError) {
					return this.#schemaFailure(error);
				}
				return this.#rejectFailure();
			}
		}
		return { acknowledged: true, models };
	}

	async deleteMany(
		partial: Partial<z.infer<Schema>>,
		options?: mongo.FindOptions,
	): Promise<Array<Instance> | null>;
	async deleteMany(
		predicate: QueryPredicate<Schema, Instance>,
		options?: mongo.FindOptions,
	): Promise<Array<Instance> | null>;
	async deleteMany(
		partial: Partial<z.infer<Schema>>,
		options?: mongo.FindOptions,
	): Promise<Array<Instance> | null>;
	async deleteMany(
		predicate: QueryPredicate<Schema, Instance>,
		options?: mongo.FindOptions,
	): Promise<Array<Instance> | null>;
	async deleteMany(
		search: Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		options?: mongo.DeleteOptions,
	): Promise<Array<Instance> | null> {
		const models: Array<Instance> = [];
		for await (const model of this.find(search)) {
			if (await this.deleteOne(model._id, options)) models.push(model);
		}
		return models.length > 0 ? models : null;
	}

	async count(
		partial?: Partial<z.infer<Schema>>,
		options?: CountOptions,
	): Promise<number>;
	async count(
		predicate?: QueryPredicate<Schema, Instance>,
		options?: CountOptions,
	): Promise<number>;
	async count(
		search?: Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		options?: CountOptions,
	): Promise<number> {
		return this.find(search, options).count();
	}

	async drop(options?: mongo.DropCollectionOptions): Promise<boolean> {
		return await this.collection.drop(options);
	}

	get collectionName(): string {
		return this.collection.collectionName;
	}

	get dbName(): string {
		return this.collection.dbName;
	}

	get hint(): mongo.Hint | undefined {
		return this.collection.hint;
	}

	set hint(hint: mongo.Hint) {
		this.collection.hint = hint;
	}

	get namespace(): string {
		return this.collection.namespace;
	}

	get readConcern(): mongo.ReadConcern | undefined {
		return this.collection.readConcern;
	}

	get readPreference(): mongo.ReadPreference | undefined {
		return this.collection.readPreference;
	}

	get timeoutMS(): number | undefined {
		return this.collection.timeoutMS;
	}

	get writeConcern(): mongo.WriteConcern | undefined {
		return this.collection.writeConcern;
	}
}
