import { expect, test } from "bun:test";
import assert from "node:assert";
import z from "zod/v4";
import type { Data } from "../types";
import { MongoClient } from "./client";
import { MongoCollection } from "./collection";
import { MongoDataBase } from "./database";
import { Model } from "./model";

test("MongoClient", async () => {
	const UserSchema = z.object({
		email: z.email("Invalid Email Address"),
		password: z
			.string()
			.regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/),
		attempts: z.number().min(0, "Must Be Greater Than or Equal To 0").default(0),
		teams: z.set(z.number()).default(new Set()),
	});
	type UserSchema = typeof UserSchema;

	class UserModel extends Model<UserSchema> {
		email!: string;
		password!: string;
		attempts: number = 0;
		teams!: Set<number>;

		constructor(data: Data) {
			super(UserSchema);
			this.hydrate(data);
		}

		get locked(): boolean {
			return this.attempts >= 3;
		}

		authenticate(password: string): boolean {
			return password === this.password;
		}
	}

	assert(import.meta.env.MONGO_CONNECTION_STRING !== undefined);
	const client = new MongoClient(import.meta.env.MONGO_CONNECTION_STRING, {
		maxPoolSize: 150,
	});

	expect(client).toBeInstanceOf(MongoClient);

	try {
		await client.connect();
		await client.db("admin").command({ ping: 1 });

		const testDB = client.db("test");
		expect(testDB).toBeInstanceOf(MongoDataBase);
		const Users = testDB.collection({
			name: "users",
			schema: UserSchema,
			model: UserModel,
			unique: ["email"],
		});
		expect(Users).toBeInstanceOf(MongoCollection);
		await Users.drop();

		let inserted = await Users.insert({
			email: "email@email.com",
			password: "$omePassw0rd",
		});
		expect(inserted.acknowledged).toBe(true);
		assert(inserted.acknowledged === true);

		let user = inserted.model;
		expect(user).toBeInstanceOf(UserModel);
		expect(user.email).toBe("email@email.com");
		expect(user.password).toBe("$omePassw0rd");
		expect(user.attempts).toBe(0);
		expect(user.teams).toBeInstanceOf(Set);
		expect(user.locked).toBe(false);
		expect(user.authenticate("$omePassw0rd")).toBe(true);
		expect(user.authenticate("wrongPassword")).toBe(false);

		let found = await Users.findOne(user._id);
		expect(found).toBeInstanceOf(UserModel);
		assert(found instanceof UserModel);
		expect(found.email).toBe("email@email.com");
		expect(found.password).toBe("$omePassw0rd");
		expect(found.attempts).toBe(0);
		expect(found.teams).toBeInstanceOf(Set);
		expect(found.locked).toBe(false);
		expect(found.authenticate("$omePassw0rd")).toBe(true);
		expect(found.authenticate("wrongPassword")).toBe(false);

		found = await Users.findOne({ email: "email@email.com" });
		expect(found).toBeInstanceOf(UserModel);
		assert(found instanceof UserModel);
		expect(found.email).toBe("email@email.com");
		expect(found.password).toBe("$omePassw0rd");
		expect(found.attempts).toBe(0);
		expect(found.teams).toBeInstanceOf(Set);
		expect(found.locked).toBe(false);
		expect(found.authenticate("$omePassw0rd")).toBe(true);
		expect(found.authenticate("wrongPassword")).toBe(false);

		found = await Users.findOne((user) => user.email === "email@email.com");
		expect(found).toBeInstanceOf(UserModel);
		assert(found instanceof UserModel);
		expect(found.email).toBe("email@email.com");
		expect(found.password).toBe("$omePassw0rd");
		expect(found.attempts).toBe(0);
		expect(found.teams).toBeInstanceOf(Set);
		expect(found.locked).toBe(false);
		expect(found.authenticate("$omePassw0rd")).toBe(true);
		expect(found.authenticate("wrongPassword")).toBe(false);

		let updated = await Users.updateOne(found._id, {
			email: "newemail@email.com",
		});
		expect(updated.acknowledged).toBeTrue();
		assert(updated.acknowledged);
		user = updated.model;
		expect(user).toBeInstanceOf(UserModel);
		assert(user instanceof UserModel);
		expect(user.email).toBe("newemail@email.com");
		expect(user.password).toBe("$omePassw0rd");
		expect(user.attempts).toBe(0);
		expect(user.teams).toBeInstanceOf(Set);
		expect(user.locked).toBe(false);
		expect(user.authenticate("$omePassw0rd")).toBe(true);
		expect(user.authenticate("wrongPassword")).toBe(false);

		updated = await Users.updateOne(user._id, (user) => {
			user.email = "email@email.com";
		});
		expect(updated.acknowledged).toBeTrue();
		assert(updated.acknowledged);
		user = updated.model;
		expect(user).toBeInstanceOf(UserModel);
		assert(user instanceof UserModel);
		expect(user.email).toBe("email@email.com");
		expect(user.password).toBe("$omePassw0rd");
		expect(user.attempts).toBe(0);
		expect(user.teams).toBeInstanceOf(Set);
		expect(user.locked).toBe(false);
		expect(user.authenticate("$omePassw0rd")).toBe(true);
		expect(user.authenticate("wrongPassword")).toBe(false);

		updated = await Users.updateOne((user) => user.email === "email@email.com", {
			email: "newemail@email.com",
		});
		expect(updated.acknowledged).toBeTrue();
		assert(updated.acknowledged);
		user = updated.model;
		expect(user).toBeInstanceOf(UserModel);
		assert(user instanceof UserModel);
		expect(user.email).toBe("newemail@email.com");
		expect(user.password).toBe("$omePassw0rd");
		expect(user.attempts).toBe(0);
		expect(user.teams).toBeInstanceOf(Set);
		expect(user.locked).toBe(false);
		expect(user.authenticate("$omePassw0rd")).toBe(true);
		expect(user.authenticate("wrongPassword")).toBe(false);

		updated = await Users.updateOne(
			(user) => user.email === "newemail@email.com",
			(user) => {
				user.email = "email@email.com";
			},
		);
		expect(updated.acknowledged).toBeTrue();
		assert(updated.acknowledged);
		user = updated.model;
		expect(user).toBeInstanceOf(UserModel);
		assert(user instanceof UserModel);
		expect(user.email).toBe("email@email.com");
		expect(user.password).toBe("$omePassw0rd");
		expect(user.attempts).toBe(0);
		expect(user.teams).toBeInstanceOf(Set);
		expect(user.locked).toBe(false);
		expect(user.authenticate("$omePassw0rd")).toBe(true);
		expect(user.authenticate("wrongPassword")).toBe(false);

		let deleted = await Users.deleteOne(user._id);
		expect(deleted).toBeInstanceOf(UserModel);
		assert(deleted instanceof UserModel);
		expect(deleted.email).toBe("email@email.com");
		expect(deleted.password).toBe("$omePassw0rd");
		expect(deleted.attempts).toBe(0);
		expect(deleted.teams).toBeInstanceOf(Set);
		expect(deleted.locked).toBe(false);
		expect(deleted.authenticate("$omePassw0rd")).toBe(true);
		expect(deleted.authenticate("wrongPassword")).toBe(false);

		inserted = await Users.insert({
			email: "email@email.com",
			password: "$omePassw0rd",
		});
		expect(inserted.acknowledged).toBe(true);
		assert(inserted.acknowledged === true);
		user = inserted.model;
		expect(user).toBeInstanceOf(UserModel);
		expect(user.email).toBe("email@email.com");
		expect(user.password).toBe("$omePassw0rd");
		expect(user.attempts).toBe(0);
		expect(user.teams).toBeInstanceOf(Set);
		expect(user.locked).toBe(false);
		expect(user.authenticate("$omePassw0rd")).toBe(true);
		expect(user.authenticate("wrongPassword")).toBe(false);

		deleted = await Users.deleteOne({ email: "email@email.com" });
		expect(deleted).toBeInstanceOf(UserModel);
		assert(deleted instanceof UserModel);
		expect(deleted.email).toBe("email@email.com");
		expect(deleted.password).toBe("$omePassw0rd");
		expect(deleted.attempts).toBe(0);
		expect(deleted.teams).toBeInstanceOf(Set);
		expect(deleted.locked).toBe(false);
		expect(deleted.authenticate("$omePassw0rd")).toBe(true);
		expect(deleted.authenticate("wrongPassword")).toBe(false);

		inserted = await Users.insert({
			email: "email@email.com",
			password: "$omePassw0rd",
		});
		expect(inserted.acknowledged).toBe(true);
		assert(inserted.acknowledged === true);
		user = inserted.model;
		expect(user).toBeInstanceOf(UserModel);
		expect(user.email).toBe("email@email.com");
		expect(user.password).toBe("$omePassw0rd");
		expect(user.attempts).toBe(0);
		expect(user.teams).toBeInstanceOf(Set);
		expect(user.locked).toBe(false);
		expect(user.authenticate("$omePassw0rd")).toBe(true);
		expect(user.authenticate("wrongPassword")).toBe(false);

		deleted = await Users.deleteOne((user) => user.email === "email@email.com");
		expect(deleted).toBeInstanceOf(UserModel);
		assert(deleted instanceof UserModel);
		expect(deleted.email).toBe("email@email.com");
		expect(deleted.password).toBe("$omePassw0rd");
		expect(deleted.attempts).toBe(0);
		expect(deleted.teams).toBeInstanceOf(Set);
		expect(deleted.locked).toBe(false);
		expect(deleted.authenticate("$omePassw0rd")).toBe(true);
		expect(deleted.authenticate("wrongPassword")).toBe(false);

		inserted = await Users.insert({ email: "email@email.com", password: "$omePassw0rd" });
		expect(inserted.acknowledged).toBe(true);
		assert(inserted.acknowledged === true);
		user = inserted.model;
		expect(user).toBeInstanceOf(UserModel);
		expect(user.email).toBe("email@email.com");
		expect(user.password).toBe("$omePassw0rd");
		expect(user.attempts).toBe(0);
		expect(user.teams).toBeInstanceOf(Set);
		expect(user.locked).toBe(false);
		expect(user.authenticate("$omePassw0rd")).toBe(true);
		expect(user.authenticate("wrongPassword")).toBe(false);

		for await (const user of Users.find()) {
			expect(user).toBeInstanceOf(UserModel);
		}

		for await (const user of Users.find({ email: "email@email.com" })) {
			expect(user).toBeInstanceOf(UserModel);
		}

		for await (const user of Users.find((user) => user.email === "email@email.com")) {
			expect(user).toBeInstanceOf(UserModel);
		}

		let users = await Users.findMany({ email: "email@email.com" });
		expect(users).toBeArray();
		assert(Array.isArray(users));
		users.forEach((user) => {
			expect(user).toBeInstanceOf(UserModel);
		});

		users = await Users.findMany((user) => user.email === "email@email.com");
		expect(users).toBeArray();
		assert(Array.isArray(users));
		users.forEach((user) => {
			expect(user).toBeInstanceOf(UserModel);
		});

		users = await Users.findMany({ email: "newemail@email.com" });
		expect(users).toBeNull();

		users = await Users.findMany((user) => user.email === "newemail@email.com");
		expect(users).toBeNull();

		let count = await Users.count();
		expect(count).toBe(1);

		count = await Users.count({ email: "email@email.com" });
		expect(count).toBe(1);

		count = await Users.count((user) => user.email === "email@email.com");
		expect(count).toBe(1);

		count = await Users.count({ email: "newemail@email.com" });
		expect(count).toBe(0);

		count = await Users.count((user) => user.email === "newemail@email.com");
		expect(count).toBe(0);

		updated = await Users.updateOne(user._id, { email: "newemail@email.com" });
		expect(updated.acknowledged).toBeTrue();
		assert(updated.acknowledged);
		user = updated.model;
		expect(user).toBeInstanceOf(UserModel);
		expect(user.email).toBe("newemail@email.com");
		expect(user.password).toBe("$omePassw0rd");
		expect(user.attempts).toBe(0);
		expect(user.teams).toBeInstanceOf(Set);
		expect(user.locked).toBe(false);
		expect(user.authenticate("$omePassw0rd")).toBe(true);
		expect(user.authenticate("wrongPassword")).toBe(false);

		updated = await Users.updateOne(user._id, (user) => {
			user.email = "email@email.com";
		});
		expect(updated.acknowledged).toBeTrue();
		assert(updated.acknowledged);
		user = updated.model;
		expect(user).toBeInstanceOf(UserModel);
		expect(user.email).toBe("email@email.com");
		expect(user.password).toBe("$omePassw0rd");
		expect(user.attempts).toBe(0);
		expect(user.teams).toBeInstanceOf(Set);
		expect(user.locked).toBe(false);
		expect(user.authenticate("$omePassw0rd")).toBe(true);
		expect(user.authenticate("wrongPassword")).toBe(false);

		updated = await Users.updateOne(user._id, { email: "email" });
		expect(updated.acknowledged).toBeFalse();

		updated = await Users.updateOne(user._id, { attempts: -1 });
		expect(updated.acknowledged).toBeFalse();

		count = await Users.count();
		expect(count).toBe(1);
	} catch (error) {
		console.error(error);
	} finally {
		await client.close();
	}
});
