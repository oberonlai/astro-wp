/**
 * Snapshot read/write utilities for WordPress content.
 *
 * Snapshot layout (relative to project root):
 *   src/config/wp-snapshot/
 *     index.json            — map of id → { slug, modified } + categories
 *     posts/<id>.json       — fully processed post (data + body)
 *
 * The snapshot stores **post-processed** entries (Markdown already converted,
 * image URLs already rewritten to local paths), so the loader's snapshot
 * branch is trivial: read file → hand to store.set().
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface SnapshotEntry {
	id: number;
	slug: string;
	modified: string;
	data: Record<string, unknown>;
	body: string;
}

export interface SnapshotCategory {
	id: string;
	title: string;
}

export interface SnapshotIndex {
	syncedAt: string;
	wpUrl: string;
	posts: Record<string, { slug: string; modified: string }>;
	categories: SnapshotCategory[];
}

/**
 * Return true when the snapshot index exists on disk.
 */
export function hasSnapshot(snapshotDir: string): boolean {
	return existsSync(join(snapshotDir, "index.json"));
}

/**
 * Read the snapshot from disk. Returns posts (fully processed) and categories.
 */
export function readSnapshot(snapshotDir: string): {
	posts: SnapshotEntry[];
	categories: SnapshotCategory[];
} {
	const indexPath = join(snapshotDir, "index.json");
	const index = JSON.parse(readFileSync(indexPath, "utf-8")) as SnapshotIndex;

	const postsDir = join(snapshotDir, "posts");
	const posts: SnapshotEntry[] = [];

	for (const id of Object.keys(index.posts)) {
		const postPath = join(postsDir, `${id}.json`);
		if (!existsSync(postPath)) continue;
		posts.push(JSON.parse(readFileSync(postPath, "utf-8")) as SnapshotEntry);
	}

	return { posts, categories: index.categories };
}

/**
 * Write a snapshot to disk. Overwrites index, writes one JSON per post,
 * and removes post files whose ids no longer appear in the new set.
 */
export function writeSnapshot(
	snapshotDir: string,
	entries: SnapshotEntry[],
	categories: SnapshotCategory[],
	wpUrl: string,
): { written: number; removed: number } {
	const postsDir = join(snapshotDir, "posts");
	mkdirSync(postsDir, { recursive: true });

	const newIds = new Set(entries.map((e) => String(e.id)));

	// Remove post files that are no longer present in the new set.
	let removed = 0;
	if (existsSync(postsDir)) {
		for (const f of readdirSync(postsDir)) {
			if (!f.endsWith(".json")) continue;
			const id = f.replace(/\.json$/, "");
			if (!newIds.has(id)) {
				rmSync(join(postsDir, f));
				removed++;
			}
		}
	}

	// Write per-post files (skip rewrite when content unchanged, so git stays quiet).
	let written = 0;
	for (const entry of entries) {
		const postPath = join(postsDir, `${entry.id}.json`);
		const next = JSON.stringify(entry, null, 2) + "\n";

		if (existsSync(postPath)) {
			const prev = readFileSync(postPath, "utf-8");
			if (prev === next) continue;
		}

		writeFileSync(postPath, next, "utf-8");
		written++;
	}

	// Index always gets rewritten (syncedAt changes).
	const index: SnapshotIndex = {
		syncedAt: new Date().toISOString(),
		wpUrl,
		posts: Object.fromEntries(
			entries.map((e) => [e.id, { slug: e.slug, modified: e.modified }]),
		),
		categories,
	};
	writeFileSync(
		join(snapshotDir, "index.json"),
		JSON.stringify(index, null, 2) + "\n",
		"utf-8",
	);

	return { written, removed };
}

/**
 * Resolve snapshot directory to an absolute path. Defaults to
 * src/config/wp-snapshot under the project root.
 */
export function resolveSnapshotDir(
	projectRoot: string,
	dir: string | undefined,
): string {
	return resolve(projectRoot, dir || "src/config/wp-snapshot");
}
