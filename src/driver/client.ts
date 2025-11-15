import mongo from "mongodb";
import { MongoDataBase } from "./database.js";

export class MongoClient {
	private readonly _client!: mongo.MongoClient;

	constructor(uri: string, options?: mongo.MongoClientOptions) {
		Object.defineProperty(this, "_client", {
			writable: false,
			configurable: false,
			enumerable: false,
			value: new mongo.MongoClient(
				uri,
				options ?? {
					serverApi: {
						version: mongo.ServerApiVersion.v1,
						strict: true,
						deprecationErrors: true,
					},
				},
			),
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
