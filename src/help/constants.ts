import { Command } from "coc.nvim";
import { SonarLintDocumentation } from "../commons";

export interface HelpAndFeedbackItem {
    id: string;
    label?: string;
    url?: string;
    command?: Command;
}

export const helpAndFeedbackItems: HelpAndFeedbackItem[] = [
    {
        id: "extensionDocs",
        label: "Extension Documentation",
        url: "https://github.com/asmodeus812/coc-sonarlint/blob/master/README.md"
    },
    {
        id: "docs",
        label: "Sonar Documentation",
        url: SonarLintDocumentation.BASE_DOCS_URL
    },
    {
        id: "tokenGenerationAndUsage",
        label: "Token generation & usage",
        url: "https://docs.sonarsource.com/sonarqube-server/10.0/user-guide/user-account/generating-and-using-tokens"
    },
    {
        id: "connectedModeDocs",
        label: "Connected mode & setup",
        url: "https://docs.sonarsource.com/sonarqube-for-vs-code/team-features/connected-mode-setup"
    },
    {
        id: "aiAgentsConfigurationDoc",
        label: "MCP & AI configuration",
        url: "https://docs.sonarsource.com/sonarqube-for-vs-code/ai-capabilities/agents#sonarqube-mcp-server"
    },
    {
        id: "sonarQubeEditionsDownloads",
        label: "Downlaods and editions",
        url: "https://www.sonarsource.com/products/sonarqube/downloads/"
    },
    {
        id: "reportBugOrFeature",
        label: "Get Help Report Issue",
        url: "https://community.sonarsource.com/c/sl/vs-code/36"
    },
    {
        id: "sonarCloudProductPage",
        label: "Cloud product page",
        url: "https://www.sonarsource.com/products/sonarcloud/"
    },
    {
        id: "sonarQubeProductPage",
        label: "Qube product page",
        url: "https://www.sonarsource.com/products/sonarqube/"
    }
];
