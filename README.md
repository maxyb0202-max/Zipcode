# CodeBox

Simple IDE for Python, Java, C and C++ on Windows (Electron + Monaco + xterm).

- Download: https://github.com/maxyb0202-max/codebox/releases/latest
- Website: https://maxyb0202-max.github.io/codebox/

## First upload

```
git init
git add .
git commit -m "CodeBox 1.1.0"
git branch -M main
git remote add origin https://github.com/maxyb0202-max/codebox.git
git push -u origin main
git tag v1.1.0
git push --tags
```

GitHub Actions builds `CodeBox-Setup.exe` and publishes it under Releases.

## Turn on the website (once)

Repo **Settings > Pages**: Source **Deploy from a branch**, branch **main**, folder **/docs**, Save.

## Ship an update

Bump `"version"` in `package.json`, then:

```
git commit -am "1.2.0"
git tag v1.2.0
git push && git push --tags
```

Installed copies offer it in the Update tab.

## Develop

- `npm install` then `npm start`
- `npm run dist` builds the installer locally into `dist/`
