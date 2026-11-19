// tRPC lists the framework of each adapter it ships as an optional peer. pnpm
// links an optional peer wherever any workspace package installs it, so the
// Docker image's @trpc/server picked up packages/dev's Next.js, and pnpm deploy
// copied its dependencies into the image. Queuedash uses tRPC's fastify, fetch
// and node-http adapters, and none of them loads its framework at runtime.
const unusedTrpcPeers = [
  "@types/aws-lambda",
  "@types/express",
  "@types/ws",
  "fastify",
  "next",
];

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "@trpc/server") {
        for (const name of unusedTrpcPeers) {
          delete pkg.peerDependencies?.[name];
          delete pkg.peerDependenciesMeta?.[name];
        }
      }
      return pkg;
    },
  },
};
