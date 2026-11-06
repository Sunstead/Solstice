/**
 * The two things Solstice releases, each versioned on its own: the desktop app
 * (`app-v*`, installers in a draft GitHub Release) and the sync server with
 * its web app (`sync-v*`, a container image). A commit releases a product only
 * if it touches that product's `paths`.
 *
 * .github/workflows/sync-image.yml filters on the same files (its `paths:`);
 * change them together.
 */
export const PRODUCTS = {
  app: {
    tagPrefix: 'app-v',
    paths: [/^apps\/desktop\//, /^crates\//, /^Cargo\.(toml|lock)$/, /^package(-lock)?\.json$/],
  },
  sync: {
    tagPrefix: 'sync-v',
    paths: [
      /^apps\/sync\//,
      // What the server links (apps/sync/Cargo.toml), not the desktop-only crates.
      /^crates\/solstice-(core|sync|sync-fs|search)\//,
      // The web app is the desktop frontend; the Tauri shell isn't in it.
      /^apps\/desktop\/(?!src-tauri\/)/,
      /^Cargo\.(toml|lock)$/,
      /^package(-lock)?\.json$/,
    ],
  },
};

/** Whether any of `files` (repo-relative) is part of `product`. */
export function touches(product, files) {
  const { paths } = PRODUCTS[product];
  return files.some((f) => paths.some((re) => re.test(f)));
}
