import typia, { type tags } from "typia";

type Password = string &
	tags.Pattern<"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.])[A-Za-z\d@$!%*.?&]{8,}$">;

export interface User {
	username: string & tags.Pattern<"^[a-zA-Z][a-zA-Z_]{7,}$">;
	email: string & tags.Format<"email">;
	attempts: number & tags.Minimum<0> & tags.Default<0>;
	password: Password;
}

if (require.main === module) {
	const valid = typia.validate<User>({
		username: "PapiLegma",
		email: "email@example.com",
		password: "P@ssword123",
	});

	console.log({ valid });
	if (!valid.success) {
		valid.errors.forEach((error) => {
			console.log(error);
		});
	}
}
