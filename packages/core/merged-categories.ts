import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import categoryData from "@/config/category.json";

interface Category {
	title: string;
	id: string;
}

/**
 * Merge local Astro categories with WordPress categories.
 *
 * WordPress categories are synced to wp-categories.json during build.
 * Duplicates (same id) are skipped — local categories take priority.
 */
function loadWpCategories(): Category[] {
	const filePath = resolve(
		import.meta.dirname || ".",
		"../config/wp-categories.json",
	);

	if (!existsSync(filePath)) return [];

	try {
		const raw = readFileSync(filePath, "utf-8");
		const data = JSON.parse(raw);
		return data.news || [];
	} catch {
		return [];
	}
}

function mergeCategories(
	local: Category[],
	wp: Category[],
): Category[] {
	const seen = new Set(local.map((c) => c.id));
	const merged = [...local];

	for (const cat of wp) {
		if (!seen.has(cat.id)) {
			merged.push(cat);
			seen.add(cat.id);
		}
	}

	return merged;
}

export const newsCategories = mergeCategories(
	categoryData.news,
	loadWpCategories(),
);

export const workCategories = categoryData.work;
