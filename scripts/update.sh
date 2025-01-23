#!/bin/bash

echo "Verify gh version"
gh --version

repo="SonarSource/sonarlint-vscode"
release_tag=$(gh release list --repo "$repo" --json tagName --jq '.[].tagName' --limit 1)
echo "Targeting $release_tag from SonarSource/sonarlint-vscode"
gh release download "$release_tag" --repo "$repo" --pattern "sonarlint-vscode-[0-9]*.[0-9]*.[0-9]*.vsix"

echo "Extracting server resource artifacts"
mkdir -p output_dir && unzip -o "*.vsix" -d output_dir
rm -rf ./server && mv ./output_dir/extension/server .
rm -rf ./analyzers && mv ./output_dir/extension/analyzers .

echo "Cleaning output artifacts"
rm -rf output_dir && rm -rf ./*.vsix
