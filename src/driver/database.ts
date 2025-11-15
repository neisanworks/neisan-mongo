import type mongo from "mongodb";
import type z from "zod/v4";
import type { CollectionModel, CollectionParameters } from "../types.js";
import { MongoCollection } from "./collection.js";

export class MongoDataBase {
	private readonly _db!: mongo.Db;

	constructor(client: mongo.MongoClient, name: string, options?: mongo.DbOptions) {
		Object.defineProperty(this, "_db", {
			writable: false,
			configurable: false,
			enumerable: false,
			value: client.db(name, options),
		});
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
}
