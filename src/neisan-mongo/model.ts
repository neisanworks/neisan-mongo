import type mongo from "mongodb";
import type z from "zod/v4";
import type { Data, JSONData } from "../types.js";

export abstract class Model<Schema extends z.ZodObject> {
	_id!: mongo.ObjectId;

	protected hydrate(data: Data) {
		Object.assign(this, data);
	}

	toJSON(): JSONData<Schema> {
		const data: Data = {};
		for (const [key, value] of Object.entries(this)) {
			data[key] = value;
		}
		return data as JSONData<Schema>;
	}
}
