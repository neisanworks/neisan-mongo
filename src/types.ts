import type mongo from "mongodb";
import type z from "zod/v4";

export type Prettier<T extends object> = { [K in keyof T]: T[K] } & {};

export type Data = Record<string, unknown>;
export type CollectionModel<Schema extends z.ZodObject> = {
	_id: mongo.ObjectId;
	toJSON(): z.infer<Schema>;
} & z.core.output<Schema>;
export type ModelConstructor<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> = new (data: Data) => Instance;

export type CollectionParameters<
	Schema extends z.ZodObject,
	Instance extends CollectionModel<Schema>,
> = Prettier<
	mongo.CollectionOptions & {
		name: string;
		schema: Schema;
		model: ModelConstructor<Schema, Instance>;
		unique?: Array<keyof Schema["shape"]>;
	}
>;

export type SchemaError<Schema extends z.ZodObject> = Partial<
	Record<keyof z.infer<Schema>, string>
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
export type CountOptions = Prettier<mongo.CountDocumentsOptions & mongo.Abortable>;
