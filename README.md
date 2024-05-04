# SonarLint for Coc.nvim

SonarLint by [Sonar](https://www.sonarsource.com/) is a free IDE extension that empowers you to fix coding issues before they exist. More than a linter, SonarLint detects and highlights issues that can lead to bugs, vulnerabilities, and code smells as you create your code. It offers clear remediation guidance and educational help, so you can fix issues before the code is committed.
Out of the box, SonarLint in Coc supports analysis of JS/TS, Python, PHP, Java, C, C++, C#, Go, and IaC code locally in your IDE.

Sonar's [Clean Code solutions](https://www.sonarsource.com/solutions/clean-code/) help developers deliver high-quality, efficient code standards that benefit the entire team or organization.

## How it works

Simply open any source file, start coding, and you will start seeing issues reported by SonarLint. Issues are highlighted in your code You can access the detailed rule description directly from your editor, using the provided contextual menu.

## Static Analysis Rules

Out of the box, SonarLint automatically checks your code against the following rules:

-   [Azure Resource Manager rules](https://rules.sonarsource.com/azureresourcemanager)
-   [C rules](https://rules.sonarsource.com/c)
-   [C++ rules](https://rules.sonarsource.com/cpp)
-   [C# rules](https://rules.sonarsource.com/csharp/)
-   [CloudFormation rules](https://rules.sonarsource.com/cloudformation)
-   [CSS rules](https://rules.sonarsource.com/css)
-   [Docker rules](https://rules.sonarsource.com/docker)
-   [Go rules](https://rules.sonarsource.com/go)
-   [HTML rules](https://rules.sonarsource.com/html)
-   [Java rules](https://rules.sonarsource.com/java)
-   [JavaScript rules](https://rules.sonarsource.com/javascript)
-   [Kubernetes rules](https://rules.sonarsource.com/kubernetes)
-   [Python and IPython notebook rules](https://rules.sonarsource.com/python)
-   [PHP rules](https://rules.sonarsource.com/php)
-   [Secrets rules](https://rules.sonarsource.com/secrets)
-   [Terraform rules](https://rules.sonarsource.com/terraform)
-   [TypeScript rules](https://rules.sonarsource.com/typescript)

## Requirements

The SonarLint language server needs a Java Runtime (JRE) 17+. If you do not have one provided in your path, please install it first. Below you will find the details on how to setup your environment

1.  the `sonarlint.ls.javaHome` variable in Coc settings if set. For instance:

   ```json
   {
     "sonarlint.ls.javaHome": "C:\\Program Files\\Java\\jdk-17"
   }
   ```

2.  embedded JRE for platform-specific installations
3.  the value of the `JDK_HOME` environment variable if set
4.  the value of the `JAVA_HOME` environment variable if set
5.  on Windows the registry is queried
6.  if a JRE is still not found then:
   1.  the `PATH` is scanned for `javac`
   2.  on macOS, the parent directory of `javac` is checked for a `java_home` binary. If that binary exists then it is executed and the result is used
   3.  the grandparent directory of `javac` is used. This is similar to `$(dirname $(dirname $(readlink $(which javac))))`

SonarLint then uses the first JRE found in these steps to check its version. If a suitable JRE cannot be found at those places, SonarLint will ask for your permission to download and manage its own version.

### JS/TS analysis specific requirements

To analyze JavaScript and TypeScript code, SonarLint requires a Node.js executable. The minimal supported version is `18.18` for standalone analysis or Connected Mode with SonarCloud. For Connected Mode with SonarQube, it depends on the version of the JS/TS analyzer on your SonarQube server. SonarLint will attempt to automatically locate Node, or you can force the location using:

```json
{
  "sonarlint.pathToNodeExecutable": "/home/yourname/.nvm/versions/node/v18.18.0/bin/node"
}
```

Analysis of TypeScript in Connected Mode with SonarQube requires the server to use version 8.1 or above.

### C and C++ analysis specific requirements

To analyze C and C++ code, SonarLint requires compile commands json file

```json
{
  "sonarlint.pathToCompileCommands": "/home/yourname/repos/proj/compile_commands.json"
}
```

Note: if you are using Microsoft compiler, the environment should be ready to build the code.

### Java analysis specific requirements

To enable the support for Java analysis, you need the coc-java extension

### Jupyter notebooks

SonarLint for Coc supports analysis of Python code inside Jupyter notebooks.

## Other settings

It is possible to specify extra analyzer properties that will be used for analysis. Example:

```jsonc
{
  "sonarlint.analyzerProperties": {
    "sonar.javascript.node.maxspace": "4096",
  },
}
```

## Contributions

Have a need in SonarLint that’s not being met? Or not being met well? Ever wish you could talk directly to the Product Manager? Well now’s your chance! Congratulations, you are SonarLint’s Product Manager for a day. If you would like to see a new feature, please create a new thread in the Community Forum here, under ["Product Manager for a Day"](https://community.sonarsource.com/c/sl/pm-for-a-day-sl/41).

With that in mind, if you would like to submit a code contribution, please create a pull request for this repository. Please explain your motives to contribute: what problem you are trying to fix, what improvement you are trying to make.

## License

Copyright 2017-2024 SonarSource.

Licensed under the [GNU Lesser General Public License, Version 3.0](http://www.gnu.org/licenses/lgpl.txt)

