const { createApp } = require("./src/app");
const { config } = require("./src/config");

const app = createApp();

app.listen(config.port, config.host, () => {
  // Keep startup log minimal and readable.
  // eslint-disable-next-line no-console
  console.log(`backend listening on http://${config.host}:${config.port}`);
});
