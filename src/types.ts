import type mongo from "mongodb";
import type z from "zod/v4";

// Utility Types
export type MaybePromise<T> = T | Promise<T>;
export type Prettier<T extends object> = { [K in keyof T]: T[K] } & {};

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
		uniques?: Array<keyof z.infer<Schema>>;
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

// Cursor Types
export type CursorCloseOptions = { timeoutMS?: number };
export type SortParameters<Schema extends z.ZodObject> = {
	[key in keyof z.infer<Schema>]?: -1 | 1;
};
export type Index<Schema extends z.ZodObject> = {
	[key in keyof z.infer<Schema>]?: -1 | 1;
};
export type CountOptions = Prettier<mongo.CountDocumentsOptions & mongo.Abortable>;
