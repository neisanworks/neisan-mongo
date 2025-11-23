import type mongo from "mongodb";
import type z from "zod/v4";
import type { CollectionModel, ModelConstructor, QueryPredicate } from "../types.js";
import type { MongoCollection } from "./collection.js";
import { decode, encode } from "../utils.js";

export type CursorCloseOptions = { timeoutMS?: number };

export class FindCursor<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> {
	private readonly collection: MongoCollection<Schema, Instance>;
	private readonly cursor: mongo.FindCursor;
	private readonly model: ModelConstructor<Schema, Instance>;
	private readonly query: Partial<z.infer<Schema>>;
	private readonly search?:
		| Partial<z.infer<Schema>>
		| QueryPredicate<Schema, Instance>
		| undefined;
	private readonly options?: mongo.FindOptions | undefined;

	constructor(
		collection: MongoCollection<Schema, Instance>,
		search?: Partial<z.infer<Schema>> | QueryPredicate<Schema, Instance>,
		options?: mongo.FindOptions,
	) {
		this.collection = collection;
		this.query = typeof search === "object" ? encode(search) : {};
		this.search = search;
		this.options = options;
		this.cursor = collection.collection.find(this.query, options);
		this.model = collection.model;
	}

	async *[Symbol.asyncIterator]() {
		while (true) {
			const next = await this.next();
			if (next.done) break;
			yield next.value;
		}
	}

	async [Symbol.asyncDispose]() {
		await this.cursor.close();
	}

	throw(error: Error) {
		throw error;
	}

	return(model?: Instance) {
		this.close();
		return { done: true, value: model };
	}

	async next(): Promise<IteratorResult<Instance>> {
		let next: IteratorResult<any> = await this.cursor.next();
		while (next) {
			const data = decode(next);
			next = await this.cursor.next();
			try {
				const value = new this.model(data);
				if (typeof this.search === "function") {
					if (await this.search(value)) {
						return { done: false, value };
					}
				} else {
					return { done: false, value };
				}
			} catch {}
		}
		return { done: true, value: undefined };
	}

	async hasNext(): Promise<boolean> {
		return await this.cursor.hasNext();
	}

	async count(): Promise<number> {
		let count: number = 0;
		for await (const _ of this.clone()) {
			count++;
		}
		return count;
	}

	async toArray(): Promise<Array<Instance>> {
		const models: Array<Instance> = [];
		let next = await this.next();
		while (!next.done) {
			models.push(next.value);
			next = await this.next();
		}
		return models;
	}

	async map<T>(mapper: (model: Instance) => T): Promise<IteratorResult<T>> {
		let next: IteratorResult<Instance> = await this.next();
		while (!next.done) {
			const value = mapper(next.value);
			next = await this.next();
			return { done: false, value };
		}
		return { done: true, value: undefined };
	}

	async close(options?: CursorCloseOptions): Promise<void> {
		return await this.cursor.close(options);
	}

	clone(): FindCursor<Schema, Instance> {
		return new FindCursor(this.collection, this.search, this.options);
	}

	sort(sort: mongo.Sort): FindCursor<Schema, Instance> {
		return new FindCursor(this.collection, this.search, { ...this.options, sort });
	}

	limit(limit: number): FindCursor<Schema, Instance> {
		return new FindCursor(this.collection, this.search, { ...this.options, limit });
	}

	skip(skip: number): FindCursor<Schema, Instance> {
		return new FindCursor(this.collection, this.search, { ...this.options, skip });
	}

	hint(hint: mongo.Hint): FindCursor<Schema, Instance> {
		return new FindCursor(this.collection, this.search, { ...this.options, hint });
	}
}
