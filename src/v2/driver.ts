import mongo, { type Sort } from "mongodb";
import z from "zod/v4";
import { decode, encode } from "../utils.js";
import type {
	CollectionModel,
	CollectionParameters,
	CountOptions,
	CursorCloseOptions,
	Data,
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
} from "./types.js";

class MongoCollection<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> {
	readonly collection!: mongo.Collection;
	readonly model!: ModelConstructor<Schema, Instance>;
	private readonly schema: Schema;
	private readonly uniques: Set<keyof z.core.output<Schema>>;

	constructor(db: mongo.Db, params: CollectionParameters<Schema, Instance>) {
		const name = params.name;
		this.schema = params.schema;
		this.uniques = new Set(params.uniques);

		if (params.uniques) {
			this.collection.createIndex(params.uniques.map((key) => String(key)));
		}
		if (params.indexes) {
			this.collection.createIndex(
				params.indexes.map((index) =>
					Object.fromEntries(
						Object.entries(index).filter((index) => index[1] !== undefined) as Array<
							[string, 1 | -1]
						>,
					),
				),
			);
		}

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

	/**
	 * Returns the exact count of models matching the filter.
	 * @param filter {Partial<z.infer<Schema>> | undefined} The filter to find matching models.
	 * @param options {CountOptions | undefined} Optional settings for the command.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @example
	 * const comments = await PostComments.count({ parent: <parent-identifier> })
	 */
	async count(filter?: Partial<z.infer<Schema>>, options?: CountOptions): Promise<number>;
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
		search?: Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		options?: CountOptions,
	): Promise<number> {
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
	 * @param filter {Partial<z.infer<Schema>>} The filter to find matching models.
	 * @param options {mongo.FindOptions | undefined} Optional settings for the command.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @example
	 * const comments = await PostComments.deleteMany({ parent: <parent-identifier> })
	 */
	async deleteMany(
		filter: Partial<z.infer<Schema>>,
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
		search: Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
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
	 * @param filter {Partial<z.infer<Schema>>} The filter to find the model to delete.
	 * @param options {mongo.DeleteOptions | undefined} Optional settings for the command.
	 * @return {Instance | null} The deleted model, or `null` if no models match the filter.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @example
	 * const user = await Users.deleteOne({ email: 'email@email.com' })
	 */
	async deleteOne(
		filter: Partial<z.infer<Schema>>,
		options?: mongo.DeleteOptions,
	): Promise<Instance | null>;
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
		search: mongo.ObjectId | Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
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

	async exists(
		id: mongo.ObjectId,
		options?: mongo.FindOneOptions
	): Promise<boolean>;
	async exists(
		filter: Partial<z.infer<Schema>>,
		options?: mongo.FindOneOptions,
	): Promise<boolean>;
	async exists(
		predicate: QueryPredicate<Schema, Instance>,
		options?: mongo.FindOneOptions,
	): Promise<boolean>;
	async exists(
		search: mongo.ObjectId | Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		options?: mongo.FindOneOptions,
	): Promise<boolean> {
		if (search instanceof mongo.ObjectId) {
			return (await this.findOne(search, options)) !== null;
		}
		return this.find(search, options).hasNext()
	}

	/**
	 * Creates a cursor for a query that can be used to iterate over results from the database.
	 * @param search {Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>} The parameters for the cursor query.
	 * @param options {mongo.FindOptions} Optional settings for the command.
	 * @return {FindCursor<Schema, Instance>} A FindCursor for the matching models.
	 * @example
	 * const cursor = Users.find((user) => user.locked)
	 * for await (const user of cursor) {
	 *     // <code implementation>
	 * }
	 */
	find(
		search?: Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		options?: mongo.FindOptions,
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
	 * @param filter {Partial<z.infer<Schema>>} The filter to find models to fetch.
	 * @param options {mongo.FindOneOptions} Optional setting for this command.
	 * @return {Promise<Array<Instance> | null>} The models matching the filter,
	 * or null if none matches.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @example
	 * const user = await Users.findMany({ attempts: 3 });
	 */
	async findMany(
		filter: Partial<z.infer<Schema>>,
		options?: mongo.FindOptions,
	): Promise<Array<Instance> | null>;
	/**
	 * Fetches multiple models from this collection.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find models to fetch.
	 * @param options {mongo.FindOneOptions} Optional setting for this command.
	 * @return {Promise<Array<Instance> | null>} The models matching the filter,
	 * or null if none matches.
	 * @example
	 * const user = await Users.findMany((user) => user.locked);
	 */
	async findMany(
		predicate: QueryPredicate<Schema, Instance>,
		options?: mongo.FindOptions,
	): Promise<Array<Instance> | null>;
	async findMany(
		search?: Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		options?: mongo.FindOptions,
	): Promise<Array<Instance> | null> {
		return this.find(search, options).toArray();
	}

	/**
	 * Fetches the model with the matching `mongo.ObjectId`.
	 * @param id {mongo.ObjectId} The id of the model to find.
	 * @param options {mongo.FindOneOptions} Optional setting for this command.
	 * @return {Instance | null} The model with the matching `mongo.ObjectId`,
	 * or null if `mongo.ObjectId` does not exist in collection.
	 * @example
	 * const user = await Users.findOne(<id>);
	 */
	async findOne(
		id: mongo.ObjectId,
		options?: mongo.FindOneOptions,
	): Promise<Instance | null>;
	/**
	 * Fetches the first model to match the filter.
	 * @param filter {Partial<z.infer<Schema>>} The filter to find the model to fetch.
	 * @param options {mongo.FindOneOptions} Optional setting for this command.
	 * @return {Instance | null} The model to match the filter, or `null` if no model matches.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @example
	 * const user = await Users.findOne({ email: 'email@email.com' });
	 */
	async findOne(
		filter: Partial<z.infer<Schema>>,
		options?: mongo.FindOneOptions,
	): Promise<Instance | null>;
	/**
	 * Fetches the first model to passes the predicate.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find the model to fetch.
	 * @param options {mongo.FindOneOptions} Optional setting for this command.        * @param options {mongo.FindOneOptions} Optional setting for this command.
	 * @return {Instance | null} The first model to pass the predicate, or `null` if no model passes.
	 * @example
	 * const user = await Users.findOne((user) => user.email.endsWith('email.com'));
	 */
	async findOne(
		predicate: QueryPredicate<Schema, Instance>,
		options?: mongo.FindOneOptions,
	): Promise<Instance | null>;
	async findOne(
		search: mongo.ObjectId | Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		options?: mongo.FindOneOptions,
	): Promise<Instance | null> {
		if (search instanceof mongo.ObjectId) {
			const match: mongo.WithId<Data> | null = await this.collection.findOne({
				_id: search,
			});
			if (match === null) return null;
			return new this.model(decode(match));
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

		for (const unique of this.uniques) {
			if (await this.collection.findOne({ [unique]: encoded[unique] })) {
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

	async transformMany<T>(
		filter: Partial<z.infer<Schema>>,
		transform: (model: Instance) => MaybePromise<T>,
		options?: mongo.FindOptions,
	): Promise<Array<T> | null>;
	async transformMany<T>(
		predicate: QueryPredicate<Schema, Instance>,
		transform: (model: Instance) => MaybePromise<T>,
		options?: mongo.FindOptions,
	): Promise<Array<T> | null>;
	async transformMany<T>(
		search: Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		transform: (model: Instance) => MaybePromise<T>,
		options?: mongo.FindOptions,
	): Promise<Array<T> | null> {
		return this.find(search, options).map(transform).toArray();
	}

	async transformOne<T>(
		id: mongo.ObjectId,
		transform: (model: Instance) => MaybePromise<T>,
		options?: mongo.FindOneOptions,
	): Promise<T | null>;
	async transformOne<T>(
		filter: Partial<z.infer<Schema>>,
		transform: (model: Instance) => MaybePromise<T>,
		options?: mongo.FindOneOptions,
	): Promise<T | null>;
	async transformOne<T>(
		predicate: QueryPredicate<Schema, Instance>,
		transform: (model: Instance) => MaybePromise<T>,
		options?: mongo.FindOneOptions,
	): Promise<T | null>;
	async transformOne<T>(
		search: mongo.ObjectId | Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		transform: (model: Instance) => MaybePromise<T>,
		options?: mongo.FindOneOptions,
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
	 * @param filter {Partial<z.infer<Schema>>} The filter to find the models to update.
	 * @param update {Partial<z.infer<Schema>>} The partial record containing the updated key-values.
	 * @param options {mongo.FindOptions} Optional settings for this operation.
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
		filter: Partial<z.infer<Schema>>,
		update: Partial<z.infer<Schema>>,
		options?: mongo.FindOptions,
	): Promise<UpdateManyResult<Schema, Instance>>;
	/**
	 * Update multiple models in this collection.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find models to update.
	 * @param update {Partial<z.infer<Schema>>} The partial record containing the updated key-values.
	 * @param options {mongo.FindOptions} Optional settings for this operation.
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
		options?: mongo.FindOptions,
	): Promise<UpdateManyResult<Schema, Instance>>;
	/**
	 * Update multiple models in this collection.
	 * @param filter {Partial<z.infer<Schema>>} The filter to find models to update.
	 * @param updater {ModelUpdater<Schema, Instance>} A function passed to update each model.
	 * @param options {mongo.FindOptions} Optional settings for this operation.
	 * @return {Promise<UpdateManyResult<Schema, Instance>>} The updated models if any are updated,
	 * or `errors` object if no models match or conflict in unique properties.
	 * @note
	 * Filter matches only models with the exact key-value pairs passed.
	 * For a more dynamic query, use a predicate.
	 * @note
	 * Updates containing unique properties will be rejected.
	 * @example
	 * const updated = await Users.updateMany({ email: 'email@email.com' }, (user) => {
	 *      user.email = 'newemail@email.com'
	 * })
	 */
	async updateMany(
		filter: Partial<z.infer<Schema>>,
		updater: ModelUpdater<Schema, Instance>,
		options?: mongo.FindOptions,
	): Promise<UpdateManyResult<Schema, Instance>>;
	/**
	 * Update multiple models in this collection.
	 * @param predicate {QueryPredicate<Schema, Instance>} The predicate to find models to update.
	 * @param updater {ModelUpdater<Schema, Instance>} A function passed to update each model.
	 * @param options {mongo.FindOptions} Optional settings for this operation.
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
		options?: mongo.FindOptions,
	): Promise<UpdateManyResult<Schema, Instance>>;
	async updateMany(
		search: Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		update: Partial<z.infer<Schema>> | ModelUpdater<Schema, Instance>,
		options?: mongo.FindOptions,
	): Promise<UpdateManyResult<Schema, Instance>> {
		if (typeof update === "object") {
			for (const unique of this.uniques) {
				if (unique in update) return this.#uniqueFailure(unique);
			}

			const parsed = await this.schema.partial().safeParseAsync(update);
			if (!parsed.success) return this.#schemaFailure(parsed.error);
		}

		const models: Array<Instance> = [];
		for await (const model of this.find(search, options)) {
			if (typeof update === "function") {
				await update(model);

				const parsed = await this.schema.safeParseAsync(model.toJSON());
				if (!parsed.success) {
					return this.#schemaFailure(parsed.error);
				}

				for (const unique of this.uniques) {
					const encoded = encode({ [unique]: model[unique] });
					if (await this.findOne(encoded)) {
						return this.#uniqueFailure(unique);
					}
				}
			} else {
				Object.assign(model, update);
			}

			const result = await this.updateOne(model._id, model.toJSON());
			if (result.acknowledged) models.push(model);
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
	 * @param filter {Partial<z.infer<Schema>>} The filter to find the model to update.
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
		filter: Partial<z.infer<Schema>>,
		update: Partial<z.infer<Schema>>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>>;
	/**
	 * Update the first model to match the filter in this collection.
	 * @param filter {Partial<z.infer<Schema>>} The filter to find the model to update.
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
		filter: Partial<z.infer<Schema>>,
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
		search: mongo.ObjectId | Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		update: Partial<z.infer<Schema>> | ModelUpdater<Schema, Instance>,
		options?: mongo.FindOneAndUpdateOptions,
	): Promise<UpdateResult<Schema, Instance>> {
		let model: Instance | null;
		if (search instanceof mongo.ObjectId) {
			model = await this.findOne(search);
		} else if (typeof search === "object") {
			model = await this.findOne(search);
		} else {
			model = await this.findOne(search);
		}

		if (model === null) {
			return {
				acknowledged: false,
				errors: { general: `No ${this.model.name} found` },
			};
		}

		if (typeof update === "function") {
			await update(model);
		} else {
			Object.assign(model, update);
		}

		const parsed = await this.schema.safeParseAsync(model);
		if (!parsed.success) {
			return this.#schemaFailure(parsed.error);
		}

		const encoded = encode(parsed.data);

		for (const unique of this.uniques) {
			const conflict = await this.findOne({
				[unique]: encoded[unique],
			} as Partial<z.infer<Schema>>);
			if (conflict && !sameID(model, conflict)) {
				return this.#uniqueFailure(unique);
			}
		}

		const updated = await this.collection.findOneAndUpdate(
			{ _id: model._id },
			{ $set: encoded },
			{ ...options },
		);
		if (updated === null) {
			return this.#rejectFailure();
		}

		return { acknowledged: true, model };
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

function sameID<Schema extends z.ZodObject, Instance extends CollectionModel<Schema>>(
	modelA: Instance,
	modelB: Instance,
): boolean {
	return modelA._id.toString() === modelB._id.toString();
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
	private readonly search?:
		| Partial<z.infer<Schema>>
		| QueryPredicate<Schema, Instance>
		| undefined;
	private readonly _limit: number;
	private readonly _skip: number;
	private skipped: number = 0;
	private yielded: number = 0;
	private readonly options?: mongo.FindOptions | undefined;
	private readonly transform?: ((model: Instance) => MaybePromise<T>) | undefined;

	constructor(
		collection: MongoCollection<Schema, Instance>,
		search?: Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		options?: mongo.FindOptions,
		transform?: (model: Instance) => MaybePromise<T>,
	) {
		this.collection = collection;
		this.query = typeof search === "object" ? encode(search) : {};
		this.search = search;

		this._limit = options?.limit ?? Infinity;
		this._skip = options?.skip ?? 0;
		this.options = options;

		if (options) {
			delete options.limit;
			delete options.skip;
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
	 * Iterates over all the documents for this cursor using the iterator, callback pattern.
	 * If the iterator returns false, iteration will stop.
	 * @param iterator {(result: T) => void | Promise<void>} The iteration callback.
	 * @return {Promise<void>}
	 * @example
	 * const cursor = Users.find((user) => user.locked);
	 * await cursor.forEach(async (user) => {
	 *     await Users.updateOne(user._id, (user) => {
	 *         user.attempts = 0;
	 *     })
	 * });
	 */
	async forEach(iterator: (result: T) => MaybePromise<void | boolean>): Promise<void> {
		for await (const model of this.clone()) {
			const result = await iterator(model);
			if (result === false) break;
		}
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
	 * @param transform {(model: Instance) => R | Promise<R>} The mapping transformation method.
	 * @return {FindCursor<Schema, Instance, R>} New FindCursor with transformed results.
	 * @note
	 * FindCursor will close when `next` is `null`. Passing a transformer which returns `null` will close this cursor.
	 * @example
	 * const cursor = Users.find().map((user) => ({ id: user._id.toString(), username: user.username }))
	 */
	map<R>(
		transform: (model: Instance) => R | Promise<R>,
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

	async return(model?: Instance): Promise<IteratorResult<Instance>> {
		await this.close();
		return { done: true, value: model };
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
