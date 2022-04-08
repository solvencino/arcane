const pump = require("pump")
const bind = require("bind-easy")
const net = require("net")
const { start } = require("repl")
const { default: axios } = require("axios")
const chalk = require("chalk")
const urlencode = require("urlencode")
const { createWriteStream, existsSync } = require("fs")
const { extname, join, basename, sep, resolve, dirname } = require("path")
const { receive } = require("@solvencino/fs-stream")
const url = require("url")

module.exports = async function ({ repl, port = 8080, address }) {
  address = url.parse(`http://${address}`)
  await new Promise((res, rej) => {
    bind.tcp(port).then((server) => {
      server.on("connection", (socket) => {
        pump(socket, net.connect({ port: address.port, host: address.hostname }), socket)
      })
      console.log(`Listening on port ${port}\n`)
      console.log(`http://localhost:${port}\n`)
      res()
    })
  })

  if (repl) {
    let pwd = sep
    const client = axios.create({
      baseURL: address.href,
      params: {
        raw: true,
      },
      validateStatus: () => true,
    })

    const replServer = start({
      prompt: chalk.bold.blueBright(`arc : ${sep} > `),
      breakEvalOnSigint: true,
      terminal: true,
    })

    replServer.on("exit", () => {
      process.kill(process.pid, "SIGINT")
    })

    replServer.defineCommand("ls", async (cmd) => {
      const res = await client.get("/" + urlencode(join(pwd, cmd)))

      if (res.status === 200) {
        const files = res.data
          .map((entry) => {
            return entry.isDir ? chalk.bold.blueBright(entry.name) : entry.name
          })
          .join("\n")
        console.log(files)
      } else {
        console.log("Invalid Path")
      }
      replServer.displayPrompt()
    })

    replServer.defineCommand("cd", async (text) => {
      const res = await client.get("/" + urlencode(join(pwd, text)), {
        params: {
          check: true,
        },
      })
      if (res.status === 200) {
        pwd = join(pwd, text)
        replServer.setPrompt(chalk.bold.blueBright(`arc : ${pwd} > `))
      } else {
        console.log("Invalid Path!")
      }
      replServer.displayPrompt()
    })

    replServer.defineCommand("clear", () => {
      process.stdout.write("\033c")
      replServer.displayPrompt()
    })

    replServer.defineCommand("cat", async (text) => {
      const res = await client.get("/download/" + urlencode(join(pwd, text)), {
        responseType: "stream",
        params: {
          raw: true,
        },
      })

      if (res.status === 200) {
        res.data.on("end", () => {
          process.stdout.write("\n")
          replServer.displayPrompt(true)
        })
        pump(res.data, process.stdout)
      } else {
        console.log("File not found!")
        replServer.displayPrompt()
      }
    })

    replServer.defineCommand("cp", async (cmd) => {
      let [src, dest] = cmd.split(" ")
      dest = resolve(dest)
      if (!existsSync(dirname(dest))) {
        console.log("Invalid Destination!")
        replServer.displayPrompt()
        return
      }
      const res = await client.get("/download/" + urlencode(join(pwd, src)), {
        responseType: "stream",
      })
      if (res.status === 200) {
        res.data.on("end", () => {
          replServer.displayPrompt()
        })
        if (res.headers["x-isdir"]) {
          pump(res.data, receive(dest))
        } else {
          if (!extname(dest)) {
            dest = join(dest, basename(src))
          }
          pump(res.data, createWriteStream(dest))
        }
      } else {
        console.log("Invalid source!")
        replServer.displayPrompt()
      }
    })

    replServer.defineCommand("status", () => {
      console.log(`Connected to ${address.href}`)

      replServer.displayPrompt()
    })

    replServer.defineCommand("help", () => {
      console.log(
        `.status                                print status
.ls                                    print contents of current directory 
.cd <path>                             chagne directory
.cp <path> <file system path>          copy files and directory 
.cat <filename>                        print contents of file
.help                                  print help
.exit                                  exit repl`
      )

      replServer.displayPrompt()
    })
  }
}
