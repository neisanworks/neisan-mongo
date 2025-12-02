import { equal } from "./utils.js";

export class EnhancedSet<T> extends Set<T> {
	override add(value: T): this {
		const exists = Array.from(this).some((v) => equal(value, v));
		if (!exists) super.add(value);
		return this;
	}
}

export class EnhancedMap<K, V> extends Map<K, V> {
	override set(key: K, value: V): this {
		Array.from(this.keys()).forEach((k) => {
			if (equal(k, key)) this.delete(k);
		});
		return super.set(key, value);
	}
}


if (require.main === module) {
	class Person {
		constructor(
			public first: string,
			public last: string,
		) {}
	}

	const enhancedSet = new EnhancedSet<Person>();
	enhancedSet.add(new Person("John", "Doe"));
	enhancedSet.add(new Person("John", "Doe"));
	console.log({ enhancedSet });
	const set = new Set<Person>();
	set.add(new Person("John", "Doe"));
	set.add(new Person("John", "Doe"));
	console.log({ set });

    const enhancedMap = new EnhancedMap<Person, string>()
    enhancedMap.set(new Person("John", "Doe"), "John Doe")
    enhancedMap.set(new Person("John", "Doe"), "John Doe")
    console.log({ enhancedMap })
    const map = new Map<Person, string>()
    map.set(new Person("John", "Doe"), "John Doe")
    map.set(new Person("John", "Doe"), "John Doe")
    console.log({ map })
}
