import fastify from "fastify";
import Bull from "bull";
import { createFastifyMiddleware } from "@queuedash/api";

const app = fastify();

app.use(
  "/admin/queues",
  createFastifyMiddleware({
    apiUrl: "",
    // queues: [
    //   {
    //     queue: new Bull("report-queue"),
    //     displayName: "Reports",
    //   },
    // ],
  })
);

app.listen(3000, () => {
  console.log("Listening on port 3000");
});
