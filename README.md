# coc-sonarlint

SonarQube for IDE (formerly SonarLint) for [coc.nvim](https://github.com/neoclide/coc.nvim).
It runs the SonarLint language server of [Sonar](https://www.sonarsource.com/) and reports
quality and security issues while you type, in C, C++, Java, Go, JavaScript, TypeScript, Python,
PHP, HTML, CSS, YAML/JSON (CloudFormation, Kubernetes, Azure Resource Manager), and secrets in any
file. With Connected Mode it uses the rule sets and project settings of a SonarQube Server or
SonarQube Cloud project.

Using it inside Neovim (commands, diagnostics, code actions, rule descriptions, findings,
hotspots) is described in `:help coc-sonarlint`, available once the extension is active. This
README covers requirements, installation, setup, settings and troubleshooting.

## Requirements

- Neovim with coc.nvim 0.0.82 or later.
- A Java Runtime (JRE) 17 or later to run the language server.
- For JavaScript and TypeScript: Node.js above 20.12.0, or 22.11.0 or later.
- For C and C++: a `compile_commands.json` compilation database.
- For Java: [coc-java](https://github.com/neoclide/coc-java) or a compatible extension.

## Installation

```vim
:CocInstall coc-sonarlint
```

The language server and the analyzers ship with the extension. The extension starts when you open a file of a supported language or a
workspace that contains a `.sonar.properties` file (see `:help coc-sonarlint-start`).

## Setup

### Java runtime

The language server needs Java 17 or later. The extension uses the first one it finds:

1. The `sonarlint.ls.javaHome` setting, for example:

```json
{
    "sonarlint.ls.javaHome": "/usr/lib/jvm/java-17-openjdk"
}
```

2. A JRE bundled in the `jre/` folder of the extension.
3. The `JDK_HOME` environment variable.
4. The `JAVA_HOME` environment variable.
5. A Java installation found on the system (the `PATH`).

If the setting points to a missing folder or to a folder without `bin/java`, the extension logs
this to the SonarLint output and tries the next source. If no Java 17+ is found, it offers to
download a JRE that only SonarLint uses (command `SonarLint.InstallManagedJre`). Extra JVM
arguments go in `sonarlint.ls.vmargs`, for example `-Xmx1024m`.

### JavaScript and TypeScript

Analysis needs Node.js above 20.12.0, or 22.11.0 or later. The extension finds Node itself; to
set it explicitly:

```json
{
    "sonarlint.pathToNodeExecutable": "/home/yourname/.nvm/versions/node/v22.11.0/bin/node"
}
```

### C and C++

C and C++ analysis needs a `compile_commands.json` compilation database from your build system:

```json
{
    "sonarlint.pathToCompileCommands": "/home/yourname/repos/proj/compile_commands.json"
}
```

The command `SonarLint.ConfigureCompilationDatabase` lets you pick one of the
`compile_commands.json` files in the workspace. With the Microsoft compiler, the environment must
be ready to build the code. If no database is configured, you get a warning, see
[Troubleshooting](#troubleshooting).

### Java projects

Java analysis needs coc-java (or a compatible extension), which provides the classpath of the
project.

### Connected Mode

Connected Mode applies the rules and settings of a SonarQube Server or SonarQube Cloud project to
your local workspace. You configure two things: a connection to the server and a binding of the
workspace folder to a project on it. Bind one local project to one remote project where you can.

1. Create a user token on the server. Project tokens have fewer permissions and some features do
   not work with them. Add the connection to your global settings (`:CocConfig`); `connectionId`
   is a unique name you choose:

```json
"sonarlint.connectedMode.connections.sonarqube": [
    {
        "serverUrl": "http://localhost:9000",
        "token": "<your-user-token>",
        "connectionId": "sonar-local"
    }
],
```

2. Bind the workspace folder in its local settings (`:CocLocalConfig`). `projectKey` is the key
   you gave the project when you created it on the server, here organization `my_org` and project
   `sonar-demo`:

```json
"sonarlint.connectedMode.project": {
    "connectionId": "sonar-local",
    "projectKey": "my_org_sonar-demo"
}
```

Instead of step 2 you can add a `sonar-project.properties` file (or `.sonarcloud.properties`,
same content) to the workspace. The workspace is then bound to that project key automatically.
The file is also needed for the first scan of a project:

```properties
sonar.projectKey=my_org_sonar-demo
sonar.organization=my_org
sonar.projectName=sonar-demo
sonar.sources=src
sonar.exclusions=**/__pycache__/**,**/*.md
```

### Local server

You can run SonarQube locally with Docker. The server image is `sonarqube:lts-community` and the
scanner image is `sonarsource/sonar-scanner-cli`.

1. Start the server with the `docker-compose.yml` of this repository: `docker-compose up -d`.
2. Open `http://localhost:9000`, log in with `admin`/`admin`, create a project and a user token.
3. Scan the project once (or let the server import it from GitHub or another platform) with
   `sonar-scan.sh` from this repository. Run it from the project
   folder (for a monorepo, its root); it reads the project key, name and organization from
   `sonar-project.properties`:

```sh
cd my-project-to-scan
./path-to-sonar-scan-script/sonar-scan.sh --token "<usr-token>" --host http://localhost:9000
```

The scanner runs in a throwaway container, uploads the code and the server analyzes it.

## Configuration

Settings go in `coc-settings.json` (`:CocConfig`, or `:CocLocalConfig` for the workspace).

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `sonarlint.rules` | object | `{}` | Customize applied rule set. |
| `sonarlint.connectedMode.servers` | array | `[]` | Deprecated. Configure one or more connection(s) to SonarQube (Server, Cloud). |
| `sonarlint.connectedMode.connections.sonarqube` | array | `[]` | Connect Sonarlint IDE to SonarQube Server to apply the same code quality and security standards as your team. |
| `sonarlint.connectedMode.connections.sonarcloud` | array | `[]` | Connect Sonarlint IDE to SonarQube Cloud to apply the same code quality and security standards as your team. |
| `sonarlint.connectedMode.project` | object | `{}` | Bind the current workspace folder to a SonarQube Server or SonarQube Cloud project. |
| `sonarlint.automaticAnalysis` | boolean | `true` | Enable or disable on-the-fly analysis of files you work on. |
| `sonarlint.changedFilesAnalysisDebounceMs` | number | `1000` | Delay (in milliseconds) after the last detected file-system change before analyzing files that were modified on disk but are not open in an editor (e.g. by an external tool or AI coding agent). |
| `sonarlint.pathToNodeExecutable` | string | - | Path to a Node.js executable (versions above 20.12.0, or 22.11.0) used to analyze JavaScript and TypeScript code. |
| `sonarlint.pathToCompileCommands` | string | - | Path to the active compilation database, e.g. `C:\\Repos\\MyProject\\compile_commands.json` |
| `sonarlint.testFilePattern` | string | `""` | Files whose name match this glob pattern are considered as test files by analyzers. |
| `sonarlint.analysisExcludesStandalone` | string | `"**/node_modules/**,**/.angular/**,**...` | Files whose name match this glob pattern will not be processed by analyzers, and will be skipped by workspace-wide analysis features (Analyze Workspace, background analysis of files changed outside the editor). |
| `sonarlint.ls.javaHome` | string | - | Path to a Java Runtime Environment (17 or more recent) used to launch the Sonarlint Language Server. |
| `sonarlint.ls.vmargs` | string | - | Extra JVM arguments used to launch the SonarLint Language Server. |
| `sonarlint.output.showVerboseLogs` | boolean | `false` | Enable verbose log level in the Sonarlint IDE output. |
| `sonarlint.analyzerProperties` | object | - | Extra properties that could be passed to the code analyzers. |
| `sonarlint.trace.server` | string or object (`off`, `messages`, `verbose`) | `"off"` | Log the communication between coc.nvim and the language server. |
| `sonarlint.disableTelemetry` | boolean | `false` | Disable sending anonymous usage statistics to SonarSource. |
| `sonarlint.focusOnNewCode` | boolean | `false` | If enabled, by default, focusing on new code shows issues introduced in the last 30 days. |
| `sonarlint.startFlightRecorder` | boolean | `false` | Start the language server's flight recorder mode. |

## Troubleshooting

- Nothing is reported: check that the extension is active (`:CocList extensions`) and open the
  log with `SonarLint.ShowSonarLintOutput`. `SonarLint.EnableLogsAndShowOutput` turns on verbose
  logs and opens the log.
- The server does not start, or "The Java Runtime Environment can not be located. ...": no
  usable Java 17+ was found (see [Java runtime](#java-runtime)). Choose "Let Sonarlint download the JRE", or set
  `sonarlint.ls.javaHome` to a Java 17+ home: the folder that contains `bin/java`, not `bin`.
- No JavaScript or TypeScript issues: set `sonarlint.pathToNodeExecutable` to a supported Node.
- "SonarLint might be unable to analyze C and C++ file(s) because there is no configured
  compilation database.": set `sonarlint.pathToCompileCommands`, or choose "Configure compile
  commands now". "Ask me later again" hides it for this session, "Do not ask for this workspace"
  and "Never ask or prompt me again" turn it off for the workspace or for good.
- "Connection to '...' failed: Please verify your token.": the token in the connection settings
  is not valid for the server. Create a new user token.
- To see the traffic between coc.nvim and the server, set `sonarlint.trace.server` to `verbose`.

## Development

```sh
npm install
npm run build
npm run watch    # rebuild on change
```

## License

Copyright 2017-2025 `SonarSource`.

Licensed under the
[GNU Lesser General Public License, Version 3.0](http://www.gnu.org/licenses/lgpl.txt)
