# SonarQube (formerly `SonarQube`)

`SonarQube` for IDE by [Sonar](https://www.sonarsource.com/) is a free,
sophisticated static analysis tool that enhances your code quality and security.
Analyze your code early—as you write or generate it. Local analysis
automatically identifies quality and security issues in real-time, even with
AI-generated code. Fix issues found using QuickFix or the AI CodeFix feature,
before pushing to your SCM. This ensures your code meets your quality standards
and is safe for running in production.

Understand the "why" behind issues with detailed contextual information, turning
`SonarQube` for IDE into your personal coding tutor, and levelling up your
coding skills.

Connect to [SonarQube Server](https://www.sonarsource.com/products/sonarqube/)
or [SonarQube Cloud](https://www.sonarsource.com/products/sonarcloud/) (you can
create a
[free SonarQube Cloud account](https://www.sonarsource.com/products/sonarcloud/signup/)
to get started), to create a powerful, unified code quality platform for your
team, throughout the software development lifecycle. This connection enables
sharing of consistent language `rulesets` and project settings, and unlocks
analysis of deeply hidden security issues, fostering collaboration and code
uniformity. Additionally, Connected Mode unlocks analysis of languages such as
COBOL, Apex, PL/SQL, T-SQL, and Ansible.

`SonarQube` for IDE is the only extension you need in ensuring both code quality
and security. It supports a wide range of languages, including C, C++, Java, Go,
JavaScript, TypeScript, Python, C#, HTML, CSS, PHP, Kubernetes, Docker and
PL/SQL. Refer to our documentation for the complete list of supported languages,
rules, and secret detection capabilities.

## How it works

Simply open any source file, start coding, and you will start seeing issues
reported by `SonarQube` for IDE. Issues are highlighted in your code and also
listed in the 'Problems' panel.

You can access the detailed rule description directly from your editor, using
the provided contextual menu.

![rule description](images/sonarqube-rule-description.gif)

## Static Analysis Rules

Out of the box, `SonarQube` automatically checks your code against the following
rules:

- [Azure Resource Manager rules](https://rules.sonarsource.com/azureresourcemanager)
- [C rules](https://rules.sonarsource.com/c)
- [C++ rules](https://rules.sonarsource.com/cpp)
- [C# rules](https://rules.sonarsource.com/csharp/)
- [CloudFormation rules](https://rules.sonarsource.com/cloudformation)
- [CSS rules](https://rules.sonarsource.com/css)
- [Docker rules](https://rules.sonarsource.com/docker)
- [Go rules](https://rules.sonarsource.com/go)
- [HTML rules](https://rules.sonarsource.com/html)
- [Java rules](https://rules.sonarsource.com/java)
- [JavaScript rules](https://rules.sonarsource.com/javascript)
- [Kubernetes rules](https://rules.sonarsource.com/kubernetes)
- [Python and IPython notebook rules](https://rules.sonarsource.com/python)
- [PHP rules](https://rules.sonarsource.com/php)
- [Secrets rules](https://rules.sonarsource.com/secrets)
- [Terraform rules](https://rules.sonarsource.com/terraform)
- [TypeScript rules](https://rules.sonarsource.com/typescript)

## Requirements

The `SonarQube` language server needs a Java Runtime (JRE) 17+. If you do not
have one provided in your path, please install it first. Below you will find the
details on how to setup your environment

1.  The `sonarlint.ls.javaHome` variable in Coc settings if set. For instance:

```json
{
    "sonarlint.ls.javaHome": "C:\\Program Files\\Java\\jdk-17"
}
```

2.  Embedded JRE for platform-specific installations
3.  The value of the `JDK_HOME` environment variable if set
4.  The value of the `JAVA_HOME` environment variable if set
5.  On Windows the registry is queried
6.  If a JRE is still not found then:
7.  The `PATH` is scanned for `javac`
8.  On macOS, the parent directory of `javac` is checked for a `java_home`
    binary. If that binary exists then it is executed and the result is used
9.  The grandparent directory of `javac` is used. This is similar to
    `$(dirname $(dirname $(readlink $(which javac))))`

`SonarQube` then uses the first JRE found in these steps to check its version.
If a suitable JRE cannot be found at those places, `SonarQube` will ask for your
permission to download and manage its own version.

This extension also provides a custom root directory where the sonar lint
binaries are to be found, in case you do not desire to use the one bundled with
this extension

```json
{
    "sonarlint.ls.directly": "/home/yourname/sonarlint"
}
```

`SonarQube` will try to prompt you when a compile commands in c or cpp projects
is not found, to disable that feature globally, and ignore the missing compile
commands you can set the following property in your coc-settings.json

```json
{
    "sonarlint.notifyMissingCompileCommands": false
}
```

The directory must contain two folders, a server/ and analyzers/, where the
server binary is located in the server/ folder and all analyzer binaries are
located in the analyzers/ folder

### JS/TS analysis specific requirements

To analyze JavaScript and TypeScript code, `SonarQube` requires a Node.js
executable. The minimal supported version is `18.18` for standalone analysis or
Connected Mode with `SonarCloud`. For Connected Mode with `SonarQube`, it
depends on the version of the JS/TS analyzer on your `SonarQube` server.
`SonarQube` will attempt to automatically locate Node, or you can force the
location using:

```json
{
    "sonarlint.pathToNodeExecutable": "/home/yourname/.nvm/versions/node/v18.18.0/bin/node"
}
```

Analysis of TypeScript in Connected Mode with `SonarQube` requires the server to
use version 8.1 or above.

### C and C++ analysis specific requirements

To analyze C and C++ code, `SonarQube` requires compile commands json file, That
file can be obtained by build system yo use to compile and package your project

```json
{
    "sonarlint.pathToCompileCommands": "/home/yourname/repos/proj/compile_commands.json"
}
```

Note: if you are using Microsoft compiler, the environment should be ready to
build the code.

### Java analysis specific requirements

To enable the support for Java analysis, you need the coc-java or any coc-java
compliant extension, and of course an up to date JDK or JRE, preferably versions
above and/or 17

## Connected Mode

To enable connected mode you need to `configure two things`, first is the actual
server to which you would like to connect to, these can either be `SonarCloud`
or `SonarQube` severs, either way these sonar servers are meant to analyze your
project source code on a remote server where your project is configured. On the
remote server a project scope is configured and you can then attach your local
project/projects to that scope, it is usually advised to have a 1:1 relationship
between `SonarQube` or `SonarCloud` projects and local projects, even though it
is possible to have multiple ones under the same `SonarQube` or `SonarCloud`
project name

First configure the connection, in this case we have an example that configures
a connection to a `SonarQube` server that is running locally, we need to also
provide a connection identifier that is unique. Each connection has a token
corresponding to it, that must be created by accessing your `SonarQube` server,
and create a token for your project specifically, it is advised that you create
and use `user tokens` which have a broader permissions otherwise some features
`might not work as expected`. This configuration
`should be put into your global coc-settings` since it is not per workspace but
providing only connection details for `SonarQube` servers

```json
"sonarlint.connectedMode.connections.sonarqube": [
    {
        "serverUrl": "http://localhost:9000",
        "token": "<your-user-token>",
        "connectionId": "sonar-local"
    }
],
```

Next we have to configure the project locally, to bind the project to a given
connection we have to adjust the local settings file and add the binding like
so. This configuration must be added to your local workspace folder
`coc-settings` file, as it is specifying precisely how to bind the
`current workspace folder to a given sonar qube server`

```json
"sonarlint.connectedMode.project": {
    "connectionId": "sonar-local",
    "projectKey": "my_org_sonar-demo"
}
```

Notice that we bind the project to a given connection id, and the `projectKey`
is a valid `projectKey` that must exist on the `SonarQube` server and must be
configured with the correct name, in this case that `projectKey` exists and is
configured on the local server in this example and the project key usually
consists of an organization id combined with a unique project name as in this
case above the org id is my_org and the name of the project is sonar-demo. When
creating a project in `SonarQube` you are required to create / assign a
`projectKey` to it, that project key is what you must use in this configuration.

Finally you might want to provide a `sonar-project.properties` file which will
be used by sonar to identify meta data for your project. That is important if
you are scanning the project for the first time, see below

```properties
sonar.projectKey=my_org_sonar-demo
sonar.organization=my_org
sonar.projectName=sonar-demo
sonar.sources=src
sonar.exclusions=**/__pycache__/**,**/*.md
```

If you have this file in your workspace the auto binding service will ensure
that this project is bound to the correct `projectKey`. Otherwise you might have
to manually configure your `coc-settings` or manually add binding for the
workspace folder of the project. Another alias for this file is the name -
`.sonarcloud.properties`, it is the same file and contains the same contents.

## Local server

It is possible to setup a local sonar qube server. Usually that can be done
using a docker container, there are two distinct steps, the first one is to
bootstrap and start the SonarQube server, then create a project inside it,
create your new token, and finally the second major step is to analyze your
project, this can be done easily with another throwaway container that runs the
sonar-scanner against your source directory which must be done for the very
first time, otherwise you can configure the project to pull source from github
or other platforms. The sonar server can be run using the following docker
image -`sonarqube:lts-community`, the scanner on the other hand is contained in
this image - `sonarsource/sonar-scanner-cli`

This repository contains a docker-compose which starts a fully loaded sonar qube
server, which you can use by simply running `docker-compose -d`. Then you can
open your browser and navigate to `http://loalhost:9000`, use admin/admin for th
username and password, and you can create your first sonar qube project from the
user interface.

To analyze, scan and load the code of your project you can run the
`sonar-scan.sh` script also located in this repository. This script `must` be
run from the local directory of your project, therefore you can simply do

`The sonar-scan script REQUIRES THE sonar-project.properties file to exist in your project directory, it is going to use the information from there such as project key, name and organization id to correctly scan your project directory`

```sh
# navigate to your project workspace folder, for monorepos that is the root of the monorepo
cd my-project-to-scan
# ensure you fill the properties file correctly to reflect your environment and setup
touch sonar-project.properties
# execute a one shot container sonar-scanner that will upload your project into sonar qube
./path-to-sonar-scan-script/sonar-scan.sh --token "<usr-token>" --host http://localhost:9000
```

This will create a throwaway container that will load your project into the
local sonar qube server, this will then force the server to analyze your project
code.

## MCP Setup

The sonar server also allows you to provide a Model Context Protocol compliant
server, the idea is to allow sonar to provide fixes through an AI agent,
external to sonar server. Sonar itself has some AI capabilities which are
currently growing but in case you wish to use external provider a json
configuration for a valid MCP server can be provided

## Contributions

Please read here about why we
[deprecated the "Suggest New Features" category](https://community.sonarsource.com/t/introducing-the-product-manager-for-a-day-subcategories/68606)
on the Community Forum. The truth is that it's extremely difficult for someone
outside `SonarSource` to comply with our roadmap and expectations. Therefore, we
typically only accept minor cosmetic changes and typo fixes.

With that in mind, if you would like to submit a code contribution, please
create a pull request for this repository. Please explain your motives to
contribute: what problem you are trying to fix, what improvement you are trying
to make.

Make sure that you follow our
[code style](https://github.com/SonarSource/sonar-developer-toolset#code-style)
and all tests are passing.

## Have Questions or Feedback?

For `SonarQube` for IDE support questions ("How do I?", "I got this error,
why?", ...), please first read the
[FAQ](https://community.sonarsource.com/t/frequently-asked-questions/7204) and
then head to the [Sonar forum](https://community.sonarsource.com/c/help/sl).
There are chances that a question similar to yours has already been answered.

Be aware that this forum is a community, so the standard pleasantries ("Hi",
"Thanks", ...) are expected. And if you don't get an answer to your thread, you
should sit on your hands for at least three days before bumping it. Operators
are not standing by. :-)

Issue tracker (read-only): `https://jira.sonarsource.com`

## License

Copyright 2017-2025 `SonarSource`.

Licensed under the
[GNU Lesser General Public License, Version 3.0](http://www.gnu.org/licenses/lgpl.txt)
