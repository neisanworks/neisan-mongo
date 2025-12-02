import type mongo from "mongodb";
import type z from "zod/v4";

// Utility Types
export type MaybePromise<T> = T | Promise<T>;
export type Prettier<T extends object> = { [K in keyof T]: T[K] } & {};
export type Join<K, P> = K extends string | number
	? P extends string | number
		? `${K}.${P}`
		: K
	: P;

export type JoinPath<
	K extends string | number,
	P extends string | number = "",
> = P extends "" ? K : `${P}.${K}`;
export type DeepPath<T, P extends string | number = ""> = Exclude<
	T extends Record<string | number, any>
		? {
				[K in keyof T]: K extends string | number
					? T[K] extends Record<string | number, any> | undefined
						? DeepPath<T[K], JoinPath<K, P>> | JoinPath<K, P>
						: JoinPath<K, P>
					: never;
			}[keyof T]
		: T extends string | number
			? JoinPath<T, P>
			: never,
	undefined
>;

export type DeepPathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
	? K extends keyof T
		? DeepPathValue<T[K], Rest>
		: never
	: P extends keyof T
		? T[P]
		: never;

// Model Types
export type Data = Record<string, unknown>;
export type JSONData<Schema extends z.ZodObject> = Prettier<
	z.infer<Schema> & { _id: string }
>;
export type HydratedData<Schema extends z.ZodObject> = Prettier<
	z.infer<Schema> & { _id: mongo.ObjectId }
>;
export type CollectionModel<Schema extends z.ZodObject> = Prettier<
	z.infer<Schema> & {
		_id: mongo.ObjectId;
		toJSON(): z.infer<Schema>;
		populate<K extends keyof z.infer<Schema>>(key: K): Promise<unknown | null>
	}
>;
export type ModelConstructor<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> = new (data: Data) => Instance;

// Collection Types
export type CollectionParameters<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> = Prettier<
	mongo.CollectionOptions & {
		name: string;
		schema: Schema;
		model: ModelConstructor<Schema, Instance>;
		uniques?: Array<string>;
		indexes?: mongo.IndexSpecification;
	}
>;
export type SchemaError<Schema extends z.ZodObject> = Partial<
	Record<keyof z.infer<Schema>, string>
>;
export type InsertRecord<Schema extends z.ZodObject> = Prettier<
	Omit<z.core.input<Schema>, "_id">
>;
export type InsertResult<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> =
	| {
			acknowledged: false;
			errors: SchemaError<Schema> | { general: string };
	  }
	| {
			model: Instance;
			acknowledged: true;
	  };
export type UpdateResult<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> =
	| {
			acknowledged: false;
			errors: SchemaError<Schema> | { general: string };
	  }
	| {
			model: Instance;
			acknowledged: true;
	  };
export type UpdateManyResult<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> =
	| {
			acknowledged: false;
			errors: SchemaError<Schema> | { general: string };
	  }
	| {
			models: Array<Instance>;
			acknowledged: true;
	  };
export type ModelUpdater<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> = (model: Instance) => any | Promise<any>;
export type QueryPredicate<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> = (model: Instance) => boolean | Promise<boolean>;
export type FindOneOptions<Schema extends z.ZodObject> = Prettier<
	mongo.FindOneOptions & {
		populate?: Array<keyof z.infer<Schema>> | keyof z.infer<Schema>;
	}
>;
export type FindOptions<Schema extends z.ZodObject> = Prettier<
	mongo.FindOptions & {
		populate?: Array<keyof z.infer<Schema>> | keyof z.infer<Schema>;
	}
>;

// Cursor Types
export type CursorCloseOptions = { timeoutMS?: number };
export type SortParameters<Schema extends z.ZodObject> = {
	[key in keyof z.infer<Schema>]?: -1 | 1;
};
export type Index<Schema extends z.ZodObject> = {
	[key in keyof z.infer<Schema>]?: -1 | 1;
};
export type CountOptions = Prettier<mongo.CountDocumentsOptions & mongo.Abortable>;
