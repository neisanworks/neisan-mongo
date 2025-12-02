import assert from "node:assert";
import mongo from "mongodb";
import z from "zod/v4";
import type {
	CollectionModel,
	CollectionParameters,
	CountOptions,
	CursorCloseOptions,
	Data,
	FindOneOptions,
	FindOptions,
	HydratedData,
	InsertResult,
	MaybePromise,
	ModelConstructor,
	ModelUpdater,
	QueryPredicate,
	SchemaError,
	SortParameters,
	UpdateManyResult,
	UpdateResult,
} from "../types.js";
import { changes, decode, encode } from "../utils.js";

class Relationship<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> {
	constructor(
		public readonly collection: MongoCollection<Schema, Instance>,
		public _id?: mongo.ObjectId,
	) {}

	async populate(): Promise<Instance | null> {
		if (!this._id) return null;
		return this.collection.findOne(this._id);
	}
}

export type RelationshipRecord<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> = {
	relationship: Relationship<Schema, Instance>;
	model?: Instance;
};


export function relationship<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
>(collection: MongoCollection<Schema, Instance>) {
	return (target: any, key: any) => {
		assert(typeof target === "object", "target should be an object");
		assert(typeof key === "string", "key should be a string");

		if (!("__relationships__" in target) || !(target.__relationships__ instanceof Map)) {
			target.__relationships__ = new Map();
		}
		assert(
			target.__relationships__ instanceof Map,
			"target.__relationships__ should be a Map",
		);

		target.__relationships__.set(key, {
			relationship: new Relationship(collection),
		});

		Object.defineProperty(target, key, {
			configurable: false,
			enumerable: true,
			get: () => {
				const value: RelationshipRecord<Schema, Instance> =
					target.__relationships__.get(key);
				if (!value) return null;
				return value.model ?? value.relationship._id ?? null;
			},
			set: (value: unknown) => {
				const current: RelationshipRecord<Schema, Instance> =
					target.__relationships__.get(key);
				assert(typeof current === "object", "current should be an object");
				assert(
					current.relationship instanceof Relationship,
					"current.relationship should be a Relationship",
				);

				if (value instanceof mongo.ObjectId) {
					current.relationship = new Relationship(collection, value);
					target.__relationships__.set(key, current);
				} else if (value instanceof collection.model) {
					current.model = value;
					target.__relationships__.set(key, current);
				} else if (value === null) {
					delete current.model;
					delete current.relationship._id;
				} else {
					throw TypeError("Invalid value for relationship");
				}
			},
		});
	};
}

export function RelationshipSchema<Schema extends z.ZodObject>(
	model: ModelConstructor<Schema, CollectionModel<Schema>>,
) {
	return z
		.instanceof(mongo.ObjectId)
		.or(z.instanceof(Relationship))
		.or(z.instanceof(model))
		.or(z.null());
}

export type Ref<T> = T extends MongoCollection<infer _, infer Instance>
	? Instance | mongo.ObjectId | null
	: never;

class MongoCollection<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> {
	readonly collection!: mongo.Collection;
	readonly model!: ModelConstructor<Schema, Instance>;
	private readonly schema: Schema;

	constructor(db: mongo.Db, params: CollectionParameters<Schema, Instance>) {
		const name = params.name;
		this.schema = params.schema;

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

		for (const unique of Array.from(new Set(params.uniques))) {
			this.collection.createIndex({ [unique]: 1 }, { unique: true, name: unique });
		}
	}

	/**
	 * Retrieves the name of the collection.
	 *
	 * @returns {string} the name of the collection.
	 */
	get collectionName(): string {
		return this.collection.collectionName;
	}

	/**
	 * Retrieves the name of the MongoDB database that this collection is a part of.
	 *
	 * @returns {string} the name of the MongoDB database.
	 */
	get dbName(): string {
		return this.collection.dbName;
	}

	/**
	 * Retrieves the hint applied to the collection.
	 *
	 * @returns {mongo.Hint | undefined} the hint applied to the collection, or undefined if no hint is set.
	 */
	get hint(): mongo.Hint | undefined {
		return this.collection.hint;
	}

	/**
	 * Sets the hint for the collection.
	 *
	 * @param {mongo.Hint} hint - the hint to set for the collection
	 */
	set hint(hint: mongo.Hint) {
		this.collection.hint = hint;
	}

	/**
	 * Retrieves the namespace of the collection.
	 *
	 * The namespace is a string that combines the name of the database
	 * and the name of the collection, separated by a dot.
	 *
	 * @returns {string} the namespace of the collection.
	 */
	get namespace(): string {
		return this.collection.namespace;
	}

	/**
	 * Retrieves the read concern applied to the collection.
	 *
	 * @returns {mongo.ReadConcern | undefined} the read concern applied to the collection, or undefined if no read concern is set.
	 */
	get readConcern(): mongo.ReadConcern | undefined {
		return this.collection.readConcern;
	}

	/**
	 * Retrieves the read preference applied to the collection.
	 *
	 * @returns {mongo.ReadPreference | undefined} the read preference applied to the collection, or undefined if no read preference is set.
	 */
	get readPreference(): mongo.ReadPreference | undefined {
		return this.collection.readPreference;
	}

	/**
	 * Retrieves the timeout in milliseconds for the collection.
	 *
	 * @returns {number | undefined} the timeout in milliseconds for the collection, or undefined if no timeout is set.
	 */
	get timeoutMS(): number | undefined {
		return this.collection.timeoutMS;
	}

	/**
	 * Retrieves the write concern applied to the collection.
	 *
	 * @returns {mongo.WriteConcern | undefined} the write concern applied to the collection, or undefined if no write concern is set.
	 */
	get writeConcern(): mongo.WriteConcern | undefined {
		return this.collection.writeConcern;
	}

	/**
	 * Returns the exact count of models matching the filter.
	 * @param filter {Data | undefined} The filter to find matching models.
	 * @param options {CountOptions | undefined} Optional settings for the command.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @example
	 * const comments = await PostComments.count({ parent: <parent-identifier> })
	 */
	async count(filter?: Data, options?: CountOptions): Promise<number>;
	/**
	 * Returns the exact count of models matching the predicate.
	 * @param predicate {QueryPredicate<Schema, Instance> | undefined} The predicate to find matching models.
	 * @param options {CountOptions | undefined} Optional settings for the command.
	 * @example
	 * const comments = await PostComments.count((comment) => comment.likes >= 30)
	 */
	async count(
		predicate?: QueryPredicate<Schema, Instance>,
		options?: CountOptions,
	): Promise<number>;
	async count(
		search?: Data | QueryPredicate<Schema, Instance>,
		options?: CountOptions,
	): Promise<number> {
		if (search === undefined) {
			return this.collection.estimatedDocumentCount(options as any);
		}
		if (typeof search === "object") {
			return this.collection.countDocuments(encode(search) as any, options as any);
		}
		return this.find(search, options).count();
	}

	/**
	 * Creates an index on this collection.
	 * @param index {SortParameters<Schema>} The key(s) and direction(s) to order the index.
	 * @return {Promise<string>} The name of the index.
	 * @note Use `1` to sort in ascending (lowest first) order, and `-1` to sort in descending (highest first) order.
	 * @example
	 * const userEmailIndex = await Users.createIndex({ email: 1 });
	 */
	async createIndex(index: SortParameters<Schema>): Promise<string> {
		return this.collection.createIndex(index as { [key: string]: mongo.IndexDirection });
	}

	/**
	 * Deletes any model that matching the filter from this collection.
	 * @param filter {Data} The filter to find matching models.
	 * @param options {mongo.FindOptions | undefined} Optional settings for the command.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @example
	 * const comments = await PostComments.deleteMany({ parent: <parent-identifier> })
	 */
	async deleteMany(
		filter: Data,
		options?: mongo.FindOptions,
	): Promise<Array<Instance> | null>;
	/**
	 * Deletes any model that matching the predicate from this collection.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find matching models.
	 * @param options {mongo.FindOptions | undefined} Optional settings for the command.
	 * @example
	 * const comments = await PostComments.deleteMany((comment) => comment.likes >= 30)
	 */
	async deleteMany(
		predicate: QueryPredicate<Schema, Instance>,
		options?: mongo.FindOptions,
	): Promise<Array<Instance> | null>;
	async deleteMany(
		search: Data | QueryPredicate<Schema, Instance>,
		options?: mongo.DeleteOptions,
	): Promise<Array<Instance> | null> {
		const models: Array<Instance> = [];
		for await (const model of this.find(search)) {
			if (await this.deleteOne(model._id, options)) models.push(model);
		}
		return models.length > 0 ? models : null;
	}

	/**
	 * Deletes the model with the matching `mongo.ObjectId` from this collection.
	 * @param id {mongo.ObjectId} The id of the model to delete.
	 * @param options {mongo.DeleteOptions | undefined} Optional settings for the command.
	 * @return {Instance | null} The deleted model, or `null` if `id` does not exist in this collection.
	 * @example
	 * const user = await Users.deleteOne(<id>)
	 */
	async deleteOne(
		id: mongo.ObjectId,
		options?: mongo.DeleteOptions,
	): Promise<Instance | null>;
	/**
	 * Deletes the first model to match the filter from this collection.
	 * @param filter {Data} The filter to find the model to delete.
	 * @param options {mongo.DeleteOptions | undefined} Optional settings for the command.
	 * @return {Instance | null} The deleted model, or `null` if no models match the filter.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @example
	 * const user = await Users.deleteOne({ email: 'email@email.com' })
	 */
	async deleteOne(filter: Data, options?: mongo.DeleteOptions): Promise<Instance | null>;
	/**
	 * Deletes the first model to match the predicate from this collection.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find the model to delete.
	 * @param options {mongo.DeleteOptions | undefined} Optional settings for the command.
	 * @return {Instance | null} The deleted model, or `null` if no models passes the predicate.
	 * @example
	 * const user = await Users.deleteOne((user) => user.attempts >= 10)
	 */
	async deleteOne(
		predicate: QueryPredicate<Schema, Instance>,
		options?: mongo.DeleteOptions,
	): Promise<Instance | null>;
	async deleteOne(
		search: mongo.ObjectId | Data | QueryPredicate<Schema, Instance>,
		options?: mongo.DeleteOptions,
	): Promise<Instance | null> {
		let model: Instance | null;
		if (search instanceof mongo.ObjectId) {
			model = await this.findOne(search);
		} else if (typeof search === "object") {
			model = await this.findOne(search);
		} else {
			model = await this.findOne(search);
		}

		if (model === null) {
			return null;
		}

		const deleted = await this.collection.deleteOne({ _id: model._id }, options);
		if (!deleted.acknowledged) return null;

		return model;
	}

	/**
	 * Drop this collection from the database, removing it permanently.
	 * New access will create a new collection.
	 * @param options {mongo.DropCollectionOptions} Optional setting for the command.
	 * @return {Promise<boolean>} A boolean representing whether the collection was dropped.
	 * @example
	 * const Users = db.collection({
	 *     name: 'users',
	 *     schema: UserSchema,
	 *     model: UserModel,
	 *     indexes: [{ email: 1 }]
	 * });
	 * const dropped = await Users.drop();
	 */
	async drop(options?: mongo.DropCollectionOptions): Promise<boolean> {
		return this.collection.drop(options);
	}

	/**
	 * Drops an index from this collection.
	 * @param name {string} The name of the index to drop.
	 * @param options {mongo.CommandOperationOptions | undefined} Optional settings for the command.
	 * @example
	 * const userEmailIndex = await Users.createIndex({ email: 1 });
	 * await Users.dropIndex(userEmailIndex);
	 */
	async dropIndex(name: string, options?: mongo.CommandOperationOptions): Promise<void> {
		await this.collection.dropIndex(name, options);
	}

	/**
	 * Checks if a record exists in this collection.
	 * @param id {mongo.ObjectId} The id of the record.
	 * @param options {mongo.FindOneOptions | undefined} Optional settings for the command.
	 * @returns {Promise<boolean>} A boolean, representing whether the record exists.
	 * @example
	 * const exists = await Users.exists(<id>)
	 */
	async exists(id: mongo.ObjectId, options?: mongo.FindOneOptions): Promise<boolean>;
	/**
	 * Checks if a record exists in this collection.
	 * @param filter {Data} A filter to query for
	 * @param options {mongo.FindOneOptions | undefined} Optional settings for the command.
	 * @returns {Promise<boolean>} A boolean, representing whether the record exists.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @example
	 * const exists = await Users.exists({ email: "<email>" })
	 */
	async exists(filter: Data, options?: mongo.FindOneOptions): Promise<boolean>;
	/**
	 * Checks if a record exists in this collection.
	 * @param predicate {QueryPredicate<Schema, Instance>} A predicate to match against.
	 * @param options {mongo.FindOneOptions | undefined} Optional settings for the command.
	 * @returns {Promise<boolean>} A boolean, representing whether the record exists.
	 * @example
	 * const exists = await Users.exists((user) => user.email === "<email>")
	 */
	async exists(
		predicate: QueryPredicate<Schema, Instance>,
		options?: mongo.FindOneOptions,
	): Promise<boolean>;
	async exists(
		search: mongo.ObjectId | Data | QueryPredicate<Schema, Instance>,
		options?: mongo.FindOneOptions,
	): Promise<boolean> {
		if (search instanceof mongo.ObjectId) {
			return (await this.findOne(search, options)) !== null;
		}
		return this.find(search, options).hasNext();
	}

	/**
	 * Creates a cursor for a query that can be used to iterate over results from the database.
	 * @param search {Data | QueryPredicate<Schema, Instance>} The parameters for the cursor query.
	 * @param options {mongo.FindOptions} Optional settings for the command.
	 * @return {FindCursor<Schema, Instance>} A FindCursor for the matching models.
	 * @example
	 * const cursor = Users.find((user) => user.locked)
	 * for await (const user of cursor) {
	 *     // <code implementation>
	 * }
	 */
	find(
		search?: Data | QueryPredicate<Schema, Instance>,
		options?: FindOptions<Schema>,
	): FindCursor<Schema, Instance> {
		return new FindCursor(this, search, options);
	}

	/**
	 * Fetches all models from this collection.
	 * @return {Promise<Array<Instance> | null>} The models matching the filter,
	 * or null if none matches.
	 * @note
	 * The caller is responsible for making sure that there is enough memory to store the results.
	 * @example
	 * const user = await Users.findMany();
	 */
	async findMany(): Promise<Array<Instance> | null>;
	/**
	 * Fetches multiple models from this collection.
	 * @param filter {Data} The filter to find models to fetch.
	 * @param options {FindOptions<Schema>} Optional setting for this command.
	 * @return {Promise<Array<Instance> | null>} The models matching the filter,
	 * or null if none matches.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @example
	 * const user = await Users.findMany({ attempts: 3 });
	 */
	async findMany(
		filter: Data,
		options?: FindOptions<Schema>,
	): Promise<Array<Instance> | null>;
	/**
	 * Fetches multiple models from this collection.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find models to fetch.
	 * @param options {FindOptions<Schema>} Optional setting for this command.
	 * @return {Promise<Array<Instance> | null>} The models matching the filter,
	 * or null if none matches.
	 * @example
	 * const user = await Users.findMany((user) => user.locked);
	 */
	async findMany(
		predicate: QueryPredicate<Schema, Instance>,
		options?: FindOptions<Schema>,
	): Promise<Array<Instance> | null>;
	async findMany(
		search?: Data | QueryPredicate<Schema, Instance>,
		options?: FindOptions<Schema>,
	): Promise<Array<Instance> | null> {
		return this.find(search, options).toArray();
	}

	/**
	 * Fetches the model with the matching `mongo.ObjectId`.
	 * @param id {mongo.ObjectId} The id of the model to find.
	 * @param options {FindOneOptions<Schema>} Optional setting for this command.
	 * @return {Instance | null} The model with the matching `mongo.ObjectId`,
	 * or null if `mongo.ObjectId` does not exist in collection.
	 * @example
	 * const user = await Users.findOne(<id>);
	 */
	async findOne(
		id: mongo.ObjectId,
		options?: FindOneOptions<Schema>,
	): Promise<Instance | null>;
	/**
	 * Fetches the first model to match the filter.
	 * @param filter {Data} The filter to find the model to fetch.
	 * @param options {FindOneOptions<Schema>} Optional setting for this command.
	 * @return {Instance | null} The model to match the filter, or `null` if no model matches.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @example
	 * const user = await Users.findOne({ email: 'email@email.com' });
	 */
	async findOne(filter: Data, options?: FindOneOptions<Schema>): Promise<Instance | null>;
	/**
	 * Fetches the first model to passes the predicate.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find the model to fetch.
	 * @param options {FindOneOptions<Schema>} Optional setting for this command.
	 * @return {Instance | null} The first model to pass the predicate, or `null` if no model passes.
	 * @example
	 * const user = await Users.findOne((user) => user.email.endsWith('email.com'));
	 */
	async findOne(
		predicate: QueryPredicate<Schema, Instance>,
		options?: FindOneOptions<Schema>,
	): Promise<Instance | null>;
	async findOne(
		search: mongo.ObjectId | Data | QueryPredicate<Schema, Instance>,
		options?: FindOneOptions<Schema>,
	): Promise<Instance | null> {
		if (search instanceof mongo.ObjectId) {
			const match: mongo.WithId<Data> | null = await this.collection.findOne({
				_id: search,
			});
			if (match === null) return null;
			const model: Instance = new this.model(decode(match));
			if (options?.populate) {
				const populate = Array.isArray(options.populate)
					? options.populate
					: [options.populate];
				if (populate.length) {
					await Promise.all(populate.map((key) => model.populate(key)));
				}
			}
			return model;
		}

		const model: IteratorResult<Instance> = await this.find(search, options).next();
		if (!model.value) return null;
		return model.value;
	}

	/**
	 * Inserts a single record into the collection.
	 * @param record {z.core.input<Schema>} Data matching the shape of `Schema` input.
	 * @param options {mongo.InsertOneOptions} Optional settings for this command.
	 * @return {Promise<InsertResult<Schema, Instance>>} The inserted model if `acknowledged` is `true`,
	 * or `errors` object if `acknowledged` is `false`.
	 * @note
	 * Record will be rejected if a unique value conflicts with one existing in the collection.
	 * @note
	 * Passed records cannot have an `_id` property.
	 * Any record with `_id` property will have it deleted.
	 * @example
	 * const UserSchema = z.object({
	 *     email: z.email(),
	 *     username: z.string().regex(<username-pattern>),
	 *     password: z.string().regex(<password-pattern>),
	 *     attempts: z.number().min(0).default(0),
	 * })
	 *
	 * const Users = db.collection({
	 *     name: 'users',
	 *     schema: UserSchema,
	 *     model: UserModel,
	 *     uniques: ['email'],
	 *     indexes: [{ email: 1 }]
	 * })
	 *
	 * const user1 = await Users.insert({
	 *      email: 'email@email.com',
	 *      username: <username>,
	 *      password: <password>
	 * })
	 * const user2 = await Users.insert({
	 *      email: 'email@email.com', // will return { acknowledged: false: errors: { [unique-key]: <message> }}
	 *      username: <username>,
	 *      password: <password>
	 * })
	 */
	async insert(
		record: z.core.input<Schema>,
		options?: mongo.InsertOneOptions,
	): Promise<InsertResult<Schema, Instance>> {
		const parse = await this.schema.safeParseAsync(record);
		if (!parse.success) {
			return this.#schemaFailure(parse.error);
		}
		if ("_id" in parse.data) delete parse.data._id;
		const encoded = encode(parse.data);

		try {
			const result = await this.collection.insertOne(encoded, options);
			if (!result.acknowledged) {
				return this.#rejectFailure();
			}

			return {
				acknowledged: true,
				model: new this.model({ ...parse.data, _id: result.insertedId }),
			};
		} catch (error: any) {
			if (error instanceof mongo.MongoServerError) {
				if (error.code === 11000) {
					const key = Object.keys(error.errorResponse.keyPattern).at(0) ?? "";
					return this.#uniqueFailure(key);
				}
			}
			return { acknowledged: false, errors: { general: "Failed to Insert Record" } };
		}
	}

	/**
	 * Transform models that match the query.
	 * @param filter {Data} The key-value pairs to query for.
	 * @param transform {(model: Instance) => MaybePromise<R>} The transformation function.
	 * @param options {FindOptions<Schema> | undefined} Optional settings for this operation.
	 * @return {Promise<Array<T> | null>} An array of the transformed data, or null if no models match query.
	 * @note
	 * The caller is responsible for ensuring there is enough memory to store the results.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @note
	 * This method uses a FindCursor to query for models.
	 * FindCursor will close when `next` is `null`.
	 * Passing a transformer which returns `null` will close this cursor.
	 * @example
	 * const cursor = Users.transformMany(
	 * 		{ attempts: 3 },
	 *      (user) => ({ id: user._id.toString(), username: user.username })
	 * )
	 */
	async transformMany<T>(
		filter: Data,
		transform: (model: Instance) => MaybePromise<T>,
		options?: mongo.FindOptions,
	): Promise<Array<T> | null>;
	/**
	 * Transform models that match the query.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find matching models.
	 * @param transform {(model: Instance) => MaybePromise<R>} The transformation function.
	 * @param options {FindOptions<Schema> | undefined} Optional settings for this operation.
	 * @return {Promise<Array<T> | null>} An array of the transformed data, or null if no models match query.
	 * @note
	 * The caller is responsible for ensuring there is enough memory to store the results.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @note
	 * This method uses a FindCursor to query for models.
	 * FindCursor will close when `next` is `null`.
	 * Passing a transformer which returns `null` will close this cursor.
	 * @example
	 * const cursor = Users.transformMany(
	 * 		(user) => user.locked,
	 *      (user) => ({ id: user._id.toString(), username: user.username })
	 * )
	 */
	async transformMany<T>(
		predicate: QueryPredicate<Schema, Instance>,
		transform: (model: Instance) => MaybePromise<T>,
		options?: FindOptions<Schema>,
	): Promise<Array<T> | null>;
	async transformMany<T>(
		search: Data | QueryPredicate<Schema, Instance>,
		transform: (model: Instance) => MaybePromise<T>,
		options?: FindOptions<Schema>,
	): Promise<Array<T> | null> {
		return this.find(search, options).map(transform).toArray();
	}

	/**
	 * Transform a model that matches the query.
	 * @param id {mongo.ObjectId} The id of the model to transform.
	 * @param transform {(model: Instance) => MaybePromise<R>} The transformation function.
	 * @param options {FindOneOptions<Schema> | undefined} Optional settings for this operation.
	 * @return {Promise<T | null>} The transformed data, or null if no match is found.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @note
	 * This method uses a FindCursor to query for models.
	 * FindCursor will close when `next` is `null`.
	 * Passing a transformer which returns `null` will close this cursor.
	 * @example
	 * const cursor = Users.transformOne(
	 * 		<id>,
	 *      (user) => ({ id: user._id.toString(), username: user.username })
	 * )
	 */
	async transformOne<T>(
		id: mongo.ObjectId,
		transform: (model: Instance) => MaybePromise<T>,
		options?: FindOneOptions<Schema>,
	): Promise<T | null>;
	/**
	 * Transform a model that matches the query.
	 * @param filter {Data} The key-value pairs to query for.
	 * @param transform {(model: Instance) => MaybePromise<R>} The transformation function.
	 * @param options {FindOneOptions<Schema> | undefined} Optional settings for this operation.
	 * @return {Promise<T | null>} The transformed data, or null if no match is found.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @note
	 * This method uses a FindCursor to query for models.
	 * FindCursor will close when `next` is `null`.
	 * Passing a transformer which returns `null` will close this cursor.
	 * @example
	 * const cursor = Users.transformOne(
	 * 		{ attempts: 3 },
	 *      (user) => ({ id: user._id.toString(), username: user.username })
	 * )
	 */
	async transformOne<T>(
		filter: Data,
		transform: (model: Instance) => MaybePromise<T>,
		options?: FindOneOptions<Schema>,
	): Promise<T | null>;
	/**
	 * Transform a model that matches the query.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find a match with.
	 * @param transform {(model: Instance) => MaybePromise<R>} The transformation function.
	 * @param options {FindOneOptions<Schema> | undefined} Optional settings for this operation.
	 * @return {Promise<T | null>} The transformed data, or null if no match is found.
	 * @note
	 * This method uses a FindCursor to query for models.
	 * FindCursor will close when `next` is `null`.
	 * Passing a transformer which returns `null` will close this cursor.
	 * @example
	 * const cursor = Users.transformOne(
	 * 		(user) => user.email.startsWith(""),
	 *      (user) => ({ id: user._id.toString(), username: user.username })
	 * )
	 */
	async transformOne<T>(
		predicate: QueryPredicate<Schema, Instance>,
		transform: (model: Instance) => MaybePromise<T>,
		options?: FindOneOptions<Schema>,
	): Promise<T | null>;
	async transformOne<T>(
		search: mongo.ObjectId | Data | QueryPredicate<Schema, Instance>,
		transform: (model: Instance) => MaybePromise<T>,
		options?: FindOneOptions<Schema>,
	): Promise<T | null> {
		let model: Instance | null = null;
		if (search instanceof mongo.ObjectId) {
			model = await this.findOne(search, options);
		} else if (typeof search === "object") {
			model = await this.findOne(search, options);
		} else {
			model = await this.findOne(search, options);
		}

		if (model === null) return null;

		return transform(model);
	}

	/**
	 * Update multiple models in this collection.
	 * @param filter {Data} The filter to find the models to update.
	 * @param update {Partial<z.infer<Schema>>} The partial record containing the updated key-values.
	 * @param options {mongo.FindOneAndUpdateOptions} Optional settings for this operation.
	 * @return {Promise<UpdateManyResult<Schema, Instance>>} The updated models if any are updated,
	 * or `errors` object if no models match or conflict in unique properties.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @note
	 * Updates containing unique properties will be rejected.
	 * @example
	 * const updated = await Users.updateMany({ email: 'email@email.com' }, { email: 'newemail@email.com' })
	 */
	async updateMany(
		filter: Data,
		update: Partial<z.infer<Schema>>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateManyResult<Schema, Instance>>;
	/**
	 * Update multiple models in this collection.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find models to update.
	 * @param update {Partial<z.infer<Schema>>} The partial record containing the updated key-values.
	 * @param options {mongo.FindOneAndUpdateOptions} Optional settings for this operation.
	 * @return {Promise<UpdateManyResult<Schema, Instance>>} The updated models if any are updated,
	 * or `errors` object if no models match or conflict in unique properties.
	 * @note
	 * Updates containing unique properties will be rejected.
	 * @example
	 * const updated = await Users.updateMany((user) => user.locked, { attempts: 0 })
	 */
	async updateMany(
		predicate: QueryPredicate<Schema, Instance>,
		update: Partial<z.infer<Schema>>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateManyResult<Schema, Instance>>;
	/**
	 * Update multiple models in this collection.
	 * @param filter {Data} The filter to find models to update.
	 * @param updater {ModelUpdater<Schema, Instance>} A function passed to update each model.
	 * @param options {mongo.FindOneAndUpdateOptions} Optional settings for this operation.
	 * @return {Promise<UpdateManyResult<Schema, Instance>>} The updated models if any are updated,
	 * or `errors` object if no models match or conflict in unique properties.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @note
	 * Updates containing unique properties will be rejected.
	 * @example
	 * const updated = await Users.updateMany(
	 *     { email: 'email@email.com' }, 
	 *     (user) => {
	 *         user.email = 'newemail@email.com'
	 *     }
	 * )
	 */
	async updateMany(
		filter: Data,
		updater: ModelUpdater<Schema, Instance>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateManyResult<Schema, Instance>>;
	/**
	 * Update multiple models in this collection.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find models to update.
	 * @param updater {ModelUpdater<Schema, Instance>} A function passed to update each model.
	 * @param options {mongo.FindOneAndUpdateOptions} Optional settings for this operation.
	 * @return {Promise<UpdateManyResult<Schema, Instance>>} The updated models if any are updated,
	 * or `errors` object if no models match or conflict in unique properties.
	 * @note
	 * Updates containing unique properties will be rejected.
	 * @example
	 * const updated = await Users.updateMany((user) => user.locked, (user) => {
	 *      user.attempts = 0;
	 * })
	 */
	async updateMany(
		predicate: QueryPredicate<Schema, Instance>,
		updater: ModelUpdater<Schema, Instance>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateManyResult<Schema, Instance>>;
	async updateMany(
		search: Data | QueryPredicate<Schema, Instance>,
		update: Partial<z.infer<Schema>> | ModelUpdater<Schema, Instance>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateManyResult<Schema, Instance>> {
		if (typeof update === "object") {
			const parsed = await this.schema.partial().safeParseAsync(update);
			if (!parsed.success) return this.#schemaFailure(parsed.error);
		}

		const models: Array<Instance> = [];
		for await (const before of this.find(search, options)) {
			const after = new this.model(before.toJSON());

			if (typeof update === "function") {
				await update(after);
			} else {
				Object.assign(after, update);
			}

			const parsed = await this.schema.safeParseAsync(after.toJSON());
			if (!parsed.success) {
				return this.#schemaFailure(parsed.error);
			}

			const diff = changes("", before.toJSON(), after.toJSON()).parse;

			if (Object.keys(diff).length === 0) {
				return { acknowledged: false, errors: { general: "No Updates to Make" } };
			}

			try {
				const updated = await this.collection.findOneAndUpdate(
					{ _id: before._id },
					diff,
					{
						...options,
						returnDocument: "after",
					},
				);
				if (updated !== null) {
					models.push(new this.model(updated))
				}
			} catch (error: any) {
				if (error instanceof mongo.MongoServerError) {
					if (error.code === 11000) {
						const key = Object.keys(error.errorResponse.keyPattern).at(0) ?? "";
						return this.#uniqueFailure(key);
					}
				}
				return { acknowledged: false, errors: { general: "Failed to Update Record" } };
			}
		}

		if (models.length === 0) {
			return {
				acknowledged: false,
				errors: { general: `No ${this.model.name} Updated` },
			};
		}

		return { acknowledged: true, models };
	}

	/**
	 * Update the first model to match the predicate in this collection.
	 * @param id {mongo.ObjectId} The `mongo.ObjectId` of the model to update.
	 * @param update {Partial<z.infer<Schema>>} The partial record containing the updated key-values.
	 * @param options {mongo.FindOptions} Optional settings for this operation.
	 * @return {Promise<UpdateResult<Schema, Instance>>} The updated model if it is found,
	 * or `errors` object no model matches or conflict in unique properties.
	 * @note
	 * Updates containing unique properties will be rejected.
	 * @example
	 * const updated = await Users.updateOne((user) => user.email === 'email@email.com', { attempts: 0 })
	 */
	async updateOne(
		id: mongo.ObjectId,
		update: Partial<z.infer<Schema>>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>>;
	/**
	 * Update multiple models in this collection.
	 * @param id {mongo.ObjectId} The `mongo.ObjectId` of the model to update.
	 * @param updater {ModelUpdater<Schema, Instance>} A function passed to update each model.
	 * @param options {mongo.FindOptions} Optional settings for this operation.
	 * @return {Promise<UpdateResult<Schema, Instance>>} The updated model if it is found,
	 * or `errors` object if `mongo.ObjectId` doesn't exist in the collection or conflict in unique properties.
	 * @note
	 * Updates containing unique properties will be rejected.
	 * @example
	 * const updated = await Users.updateOne(<id>, (user) => {
	 *      user.attempts = 0;
	 * })
	 */
	async updateOne(
		id: mongo.ObjectId,
		updater: ModelUpdater<Schema, Instance>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>>;
	/**
	 * Update the first model to match the predicate in this collection.
	 * @param filter {Data} The filter to find the model to update.
	 * @param update {Partial<z.infer<Schema>>} The partial record containing the updated key-values.
	 * @param options {mongo.FindOptions} Optional settings for this operation.
	 * @return {Promise<UpdateResult<Schema, Instance>>} The updated model if it is found,
	 * or `errors` object no model matches or conflict in unique properties.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @note
	 * Updates containing unique properties will be rejected.
	 * @example
	 * const updated = await Users.updateOne((user) => user.email === 'email@email.com', { attempts: 0 })
	 */
	async updateOne(
		filter: Data,
		update: Partial<z.infer<Schema>>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>>;
	/**
	 * Update the first model to match the filter in this collection.
	 * @param filter {Data} The filter to find the model to update.
	 * @param updater {ModelUpdater<Schema, Instance>} A function passed to update each model.
	 * @param options {mongo.FindOptions} Optional settings for this operation.
	 * @return {Promise<UpdateResult<Schema, Instance>>} The updated model if it is found,
	 * or `errors` object no model matches or conflict in unique properties.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @note
	 * Updates containing unique properties will be rejected.
	 * @example
	 * const updated = await Users.updateOne({ email: 'email@email.com' }, (user) => {
	 *      user.attempts = 0;
	 * })
	 */
	async updateOne(
		filter: Data,
		updater: ModelUpdater<Schema, Instance>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>>;
	/**
	 * Update the first model to match the predicate in this collection.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find the model to update.
	 * @param update {Partial<z.infer<Schema>>} The partial record containing the updated key-values.
	 * @param options {mongo.FindOptions} Optional settings for this operation.
	 * @return {Promise<UpdateResult<Schema, Instance>>} The updated model if it is found,
	 * or `errors` object no model matches or conflict in unique properties.
	 * @note
	 * Updates containing unique properties will be rejected.
	 * @example
	 * const updated = await Users.updateOne((user) => user.email === 'email@email.com', { attempts: 0 })
	 */
	async updateOne(
		predicate: QueryPredicate<Schema, Instance>,
		update: Partial<z.infer<Schema>>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>>;
	/**
	 * Update the first model to match the predicate in this collection.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find the model to update.
	 * @param updater {ModelUpdater<Schema, Instance>} A function passed to update each model.
	 * @param options {mongo.FindOptions} Optional settings for this operation.
	 * @return {Promise<UpdateResult<Schema, Instance>>} The updated model if it is found,
	 * or `errors` object no model matches or conflict in unique properties.
	 * @note
	 * Updates containing unique properties will be rejected.
	 * @example
	 * const updated = await Users.updateOne({ email: 'email@email.com' }, (user) => {
	 *      user.attempts = 0;
	 * })
	 */
	async updateOne(
		predicate: QueryPredicate<Schema, Instance>,
		updater: ModelUpdater<Schema, Instance>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>>;
	async updateOne(
		search: mongo.ObjectId | Data | QueryPredicate<Schema, Instance>,
		update: Partial<z.infer<Schema>> | ModelUpdater<Schema, Instance>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>> {
		let before: Instance | null;
		if (search instanceof mongo.ObjectId) {
			before = await this.findOne(search);
		} else if (typeof search === "object") {
			before = await this.findOne(search);
		} else {
			before = await this.findOne(search);
		}

		if (before === null) {
			return {
				acknowledged: false,
				errors: { general: `No ${this.model.name} found` },
			};
		}

		const after = new this.model(before.toJSON());

		if (typeof update === "function") {
			await update(after);
		} else {
			Object.assign(after, update);
		}

		const parsed = await this.schema.safeParseAsync(after.toJSON());
		if (!parsed.success) {
			return this.#schemaFailure(parsed.error);
		}

		const diff = changes("", before.toJSON(), after.toJSON()).parse;

		if (Object.keys(diff).length === 0) {
			return { acknowledged: false, errors: { general: "No Updates to Make" } };
		}

		try {
			const updated = await this.collection.findOneAndUpdate({ _id: before._id }, diff, {
				...options,
				returnDocument: "after",
			});
			if (updated === null) {
				return this.#rejectFailure();
			}

			return { acknowledged: true, model: new this.model(updated) };
		} catch (error: any) {
			if (error instanceof mongo.MongoServerError) {
				if (error.code === 11000) {
					const key = Object.keys(error.errorResponse.keyPattern).at(0) ?? "";
					return this.#uniqueFailure(key);
				}
			}
			return { acknowledged: false, errors: { general: "Failed to Update Record" } };
		}
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
}

class FindCursor<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
	T = Instance,
> {
	private readonly collection: MongoCollection<Schema, Instance>;
	private readonly cursor: mongo.FindCursor;
	private readonly model: ModelConstructor<Schema, Instance>;
	private readonly query: Partial<z.infer<Schema>>;
	private readonly search?: Data | QueryPredicate<Schema, Instance> | undefined;
	private readonly _limit: number;
	private readonly _skip: number;
	private skipped: number = 0;
	private yielded: number = 0;
	private readonly options?: FindOptions<Schema> | undefined;
	private readonly transform?: ((model: Instance) => MaybePromise<T>) | undefined;
	private readonly _populate: Array<keyof z.infer<Schema>>;

	constructor(
		collection: MongoCollection<Schema, Instance>,
		search?: Data | QueryPredicate<Schema, Instance>,
		options?: FindOptions<Schema>,
		transform?: (model: Instance) => MaybePromise<T>,
	) {
		this.collection = collection;
		this.query = typeof search === "object" ? encode(search) : {};
		this.search = search;

		this._limit = options?.limit ?? Infinity;
		this._skip = options?.skip ?? 0;
		this._populate = !options?.populate
			? []
			: Array.isArray(options.populate)
				? options.populate
				: [options.populate];
		this.options = options;

		if (options) {
			delete options.limit;
			delete options.skip;
			delete options.populate;
		}

		this.transform = transform;
		this.cursor = collection.collection.find(this.query, options);
		this.model = collection.model;
	}

	/**
	 * The cursor is closed and all remaining locally buffered documents have been iterated.
	 * @return {boolean} Whether the `FindCursor<Schema, Instance>` is closed.
	 * @example
	 * const cursor = Users.find((user) => user.email.startsWith('example'));
	 *
	 * let closed = cursor.closed; // Returns `false`
	 * await cursor.close();
	 * closed = cursor.closed; // Returns `true`
	 * */
	get closed(): boolean {
		return this.cursor.closed;
	}

	/**
	 * An alias for {@link FindCursor.close()}
	 * @return {Promise<void>}
	 * @experimental
	 */
	async [Symbol.asyncDispose](): Promise<void> {
		await this.cursor.close();
	}

	/**
	 * @return {AsyncGenerator<Instance, void, unknown>}
	 */
	async *[Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
		while (true) {
			if (this._skip > this.skipped) continue;
			if (this.yielded >= this._limit) break;
			const next: IteratorResult<T> = await this.next();
			if (next.done) break;
			yield next.value;
		}
	}

	/**
	 * Creates a new uninitialized copy of this cursor,
	 * with options matching those that have been set on the current instance.
	 *
	 * @return {FindCursor<Schema, Instance, T>} A clone of the `FindCursor<Schema, Instance>`.
	 * @example
	 * const cursor = Users.find((user) => user.email.startsWith('example'))
	 * const clone = cursor.clone()
	 */
	clone(): FindCursor<Schema, Instance, T> {
		return new FindCursor(this.collection, this.search, this.options, this.transform);
	}

	/**
	 * Frees any client-side resources used by the cursor.
	 *
	 * @example
	 * const cursor = Users.find((user) => user.email.startsWith('example'));
	 * cursor.close();
	 * */
	async close(options?: CursorCloseOptions): Promise<void> {
		return await this.cursor.close(options);
	}

	/**
	 * @return {Promise<number>} An exact count of documents matching the filter.
	 * @example
	 * const cursor = Users.find((user) => user.locked);
	 * const lockedUsers = await cursor.count();
	 */
	async count(): Promise<number> {
		let count: number = 0;
		for await (const _ of this.clone()) {
			count++;
		}
		return count;
	}

	/**
	 * @return {Promise<boolean>} Whether this cursor has a next IterableResult.
	 */
	async hasNext(): Promise<boolean> {
		const clone = this.clone().skip(this.yielded);
		return !(await clone.next()).done;
	}

	/**
	 * Set this cursor hint.
	 * @param hint {mongo.Hint} If specified, then the query system will only consider plans using the hinted index.
	 * @return {FindCursor<Schema, Instance, T>} New FindCursor with hint applied.
	 * @example
	 * const cursor = Users.find((user) => user.locked).hint({ attempts: 1 });
	 */
	hint(hint: mongo.Hint): FindCursor<Schema, Instance, T> {
		return new FindCursor(
			this.collection,
			this.search,
			{ ...this.options, hint },
			this.transform,
		);
	}

	/**
	 * Set the limit for this cursor.
	 * @param limit {number} The limit for this cursor query.
	 * @return {FindCursor<Schema, Instance, T>} New FindCursor with limit applied.
	 * @example
	 * const cursor = Users.find((user) => user.locked).limit(10);
	 */
	limit(limit: number): FindCursor<Schema, Instance, T> {
		return new FindCursor(
			this.collection,
			this.search,
			{ ...this.options, limit },
			this.transform,
		);
	}

	/**
	 * Map all documents using the provided function.
	 * If there is a transform set on this cursor, that will be called
	 * first and the result passed to this function's transform.
	 * @param transform {(model: Instance) => MaybePromise<R>} The mapping transformation method.
	 * @return {FindCursor<Schema, Instance, R>} New FindCursor with transformed results.
	 * @note
	 * FindCursor will close when `next` is `null`. Passing a transformer which returns `null` will close this cursor.
	 * @example
	 * const cursor = Users.find().map((user) => ({ id: user._id.toString(), username: user.username }))
	 */
	map<R>(
		transform: (model: Instance) => MaybePromise<R>,
	): FindCursor<Schema, Instance, R> {
		return new FindCursor(this.collection, this.search, this.options, transform);
	}

	/**
	 * Get the next available model from this cursor.
	 * If this cursor is mapped, available models will be returned transformed.
	 * Returns `{ done: true, value: undefined }` if no more models are available.
	 * @return {IteratorResult<T>} An IterableResult with T | undefined as the value.
	 */
	async next(): Promise<IteratorResult<T>> {
		let next: Data | null = await this.cursor.next();
		while (next !== null) {
			if (this.yielded >= this._limit) break;

			const data: HydratedData<Schema> = decode(next);
			let value: Instance | T = new this.model(data);
			if (typeof this.search === "function") {
				if (await this.search(value)) {
					if (this._populate.length) {
						await Promise.all(
							this._populate.map((key) => (value as Instance).populate(key)),
						);
					}
					if (this.transform) value = await this.transform(value);
					if (value === null) return { done: true, value: undefined };

					if (this._skip > this.skipped) {
						this.skipped++;
						continue;
					}

					this.yielded++;

					return { done: false, value } as IteratorResult<T>;
				} else {
					next = await this.cursor.next();
				}
			} else {
				if (this._populate.length) {
					await Promise.all(
						this._populate.map((key) => (value as Instance).populate(key)),
					);
				}
				if (this.transform) value = await this.transform(value);
				if (value === null) return { done: true, value: undefined };

				if (this._skip > this.skipped) {
					this.skipped++;
					continue;
				}

				this.yielded++;

				return { done: false, value } as IteratorResult<T>;
			}
		}
		await this.close();
		return { done: true, value: undefined };
	}

	/**
	 * Set the population of this cursor.
	 * @param key The key of the relationship to populate.
	 * @returns A new FindCursor that will yield models with the populated relationship.
	 * @example
	 * const cursor = Posts.find().populate("author");
	 */
	populate<K extends keyof z.infer<Schema>>(key: K): FindCursor<Schema, Instance, T>;
	/**
	 * Set the population of this cursor.
	 * @param keys The keys of the relationships to populate.
	 * @returns A new FindCursor that will yield models with the populated relationships.
	 * @example
	 * const cursor = Posts.find().populate(["author", "comments"]);
	 */
	populate<K extends keyof z.infer<Schema>>(
		keys: Array<K>,
	): FindCursor<Schema, Instance, T>;
	populate<K extends keyof z.infer<Schema>>(
		populate: K | Array<K>,
	): FindCursor<Schema, Instance, T> {
		return new FindCursor(
			this.collection,
			this.search,
			{ ...this.options, populate },
			this.transform,
		);
	}

	/**
	 * Rewind this cursor to its uninitialized state.
	 * Any options that are present on the cursor will remain in effect.
	 * Iterating this cursor will cause new queries to be sent to the server,
	 * even if the resultant data has already been retrieved by this cursor.
	 * @return {void}
	 */
	rewind(): void {
		this.cursor.rewind();
		this.skipped = 0;
		this.yielded = 0;
	}

	/**
	 * Set the skip for this cursor.
	 * @param skip {number} The skip of this cursor query.
	 */
	skip(skip: number): FindCursor<Schema, Instance, T> {
		return new FindCursor(
			this.collection,
			this.search,
			{ ...this.options, skip },
			this.transform,
		);
	}

	/**
	 * Sets the sort order of this cursor query.
	 * @param sort {SortParameters<Schema>} The key(s) and direction(s) set for the sort.
	 * @return {FindCursor<Schema, Instance, T>} New FindCursor with sort applied.
	 * @note Use `1` to sort in ascending (lowest first) order, and `-1` to sort in descending (highest first) order.
	 * @example
	 * const cursor = BlogPosts.find().limit(10).sort({ views: -1 });
	 */
	sort(sort: SortParameters<Schema>): FindCursor<Schema, Instance> {
		return new FindCursor(this.collection, this.search, {
			...this.options,
			sort: sort as mongo.Sort,
		});
	}

	/**
	 * Returns an array of documents. The caller is responsible for making sure that
	 * there is enough memory to store the results.
	 * @returns {Array<Instance> | null} An array of models, or null if no matches
	 * @note
	 * The array only contains partial results when this cursor had been previously accessed.
	 * In that case, cursor.rewind() can be used to reset the cursor.
	 * @example
	 * const posts = await BlogPosts.find().limit(10).sort({ views: -1 }).toArray();
	 */
	async toArray(): Promise<Array<T> | null> {
		const results: Array<T> = [];
		for await (const result of this) {
			results.push(result);
		}
		return results.length > 0 ? results : null;
	}
}

class MongoDataBase {
	private readonly _db!: mongo.Db;

	constructor(client: mongo.MongoClient, name: string, options?: mongo.DbOptions) {
		Object.defineProperty(this, "_db", {
			writable: false,
			configurable: false,
			enumerable: false,
			value: client.db(name, options),
		});
	}

	get bsonOptions(): mongo.BSONSerializeOptions {
		return this._db.bsonOptions;
	}

	get databaseName(): string {
		return this._db.databaseName;
	}

	get namespace(): string {
		return this._db.namespace;
	}

	get options(): mongo.DbOptions | undefined {
		return this._db.options;
	}

	get readConcern(): mongo.ReadConcern | undefined {
		return this._db.readConcern;
	}

	get readPreference(): mongo.ReadPreference | undefined {
		return this._db.readPreference;
	}

	get secondaryOk(): boolean | undefined {
		return this._db.secondaryOk;
	}

	get timeoutMS(): number | undefined {
		return this._db.timeoutMS;
	}

	get writeConcern(): mongo.WriteConcern | undefined {
		return this._db.writeConcern;
	}

	admin(): mongo.Admin {
		throw new Error("Method not implemented.");
	}

	collection<Schema extends z.ZodObject, Instance extends CollectionModel<Schema>>(
		params: CollectionParameters<Schema, Instance>,
	): MongoCollection<Schema, Instance> {
		return new MongoCollection(this._db, params);
	}

	async command(
		command: mongo.BSON.Document,
		options?: mongo.RunCommandOptions & mongo.Abortable,
	) {
		return this._db.command(command, options);
	}
}

export class MongoClient {
	private readonly _client!: mongo.MongoClient;

	constructor(uri: string, options?: mongo.MongoClientOptions) {
		Object.defineProperty(this, "_client", {
			writable: false,
			configurable: false,
			enumerable: false,
			value: new mongo.MongoClient(uri, {
				serverApi: {
					version: mongo.ServerApiVersion.v1,
					strict: true,
					deprecationErrors: true,
				},
				...options,
			}),
		});
	}

	db(name: string, options?: mongo.DbOptions) {
		return new MongoDataBase(this._client, name, options);
	}

	async connect(): Promise<MongoClient> {
		await this._client.connect();
		return this;
	}

	async close(): Promise<void> {
		return await this._client.close();
	}
}
