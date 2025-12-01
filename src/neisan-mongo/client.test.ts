import { expect, test } from "bun:test";
import * as mongo from "mongodb";
import * as z from "zod/v4";
import { MongoClient } from "./client";
import { Model } from "./model";
import type { Data } from "../types";

const UserSchema = z.object({
	email: z.email("Invalid Email Address"),
	password: z
		.string()
		.regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/),
	attempts: z.number().min(0, "Must Be Greater Than or Equal To 0").default(0),
	teams: z.set(z.number()).default(new Set()),
	edited: z.coerce.date().default(() => new Date()),
});
type UserSchema = typeof UserSchema;

class UserModel extends Model<UserSchema> {
	email: string;
	password: string;
	attempts: number;
	teams: Set<number>;
	edited: Date;

	constructor(data: Data) {
		super();
		this.hydrate(data);
	}

	get locked(): boolean {
		return this.attempts >= 3;
	}

	authenticated(password: string): boolean {
		return password === this.password;
	}
}

const client = new MongoClient(process.env.MONGO_CONNECTION_STRING ?? "", {
	maxPoolSize: 150,
});
const db = client.db("test");
const Users = db.collection({
	name: "users",
	schema: UserSchema,
	model: UserModel,
	uniques: ["email"],
});

test("Collection Usage", async () => {
	await Users.drop();
	const inserted = await Users.insert({
		email: "email@email.com",
		password: "$omePassw0rd",
	});
	expect(inserted.acknowledged).toBeTrue();
	if (!inserted.acknowledged) return;

	expect(inserted.model).toBeInstanceOf(UserModel);
	expect(inserted.model._id).toBeInstanceOf(mongo.ObjectId);
	expect(inserted.model.authenticated("$omePassw0rd")).toBeTrue();

	expect(await Users.count()).toEqual(1);

	const found = await Users.findOne(inserted.model._id);
	expect(found).toBeInstanceOf(UserModel);
	if (!(found instanceof UserModel)) return;
	expect(found._id).toEqual(inserted.model._id);

	const updated = await Users.updateOne(found._id, (user) => {
		user.email = "newemail@email.com";
	});
	expect(updated.acknowledged).toBeTrue();
	if (!updated.acknowledged) return;
	expect(updated.model).toBeInstanceOf(UserModel);
	expect(updated.model.email).toEqual("newemail@email.com");

	const transformed = await Users.transformOne(updated.model._id, (user) => user.email);
	expect(transformed).toEqual("newemail@email.com");

	const deleted = await Users.deleteOne(updated.model._id);
	expect(deleted).toBeInstanceOf(UserModel);
	if (deleted === null) return;
	expect(deleted.email).toEqual("newemail@email.com");

	for (let i = 1; i < 6; i++) {
		const inserted = await Users.insert({
			email: `email${i}@email.com`,
			password: "$omePassw0rd",
		});
		expect(inserted.acknowledged).toBeTrue();
		if (!inserted.acknowledged) return;

		expect(inserted.model).toBeInstanceOf(UserModel);
		expect(inserted.model._id).toBeInstanceOf(mongo.ObjectId);
		expect(inserted.model.authenticated("$omePassw0rd")).toBeTrue();

		expect(await Users.count()).toEqual(i);
	}

	const foundMany = await Users.findMany();
	expect(foundMany).toBeArrayOfSize(5);
	if (foundMany === null) return;

	const updatedMany = await Users.updateMany({}, (user) => {
		user.email = `new${user.email}`;
	});
	expect(updatedMany.acknowledged).toBeTrue();
	if (!updatedMany.acknowledged) return;
	expect(updatedMany.models).toBeArrayOfSize(5);

	for (let i = 1; i < 6; i++) {
		const found = await Users.findOne({ email: `newemail${i}@email.com` });
		expect(found).toBeInstanceOf(UserModel);
	}

	const transformedMany = await Users.transformMany({}, (user) => user.email);
	expect(transformedMany).toBeArrayOfSize(5);
	if (transformedMany === null) return;
	transformedMany.forEach((email) => {
		expect(email).toEndWith("@email.com");
	});

	for (let i = 1; i < 6; i++) {
		const found = await Users.deleteOne({ email: `newemail${i}@email.com` });
		expect(found).toBeInstanceOf(UserModel);
	}

	await Users.insert({ email: "email@email.com", password: "$omePassw0rd" });
});
