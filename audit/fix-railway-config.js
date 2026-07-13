const fs = require('fs');
const os = require('os');
const path = require('path');

const configPath = path.join(os.homedir(), '.railway', 'config.json');

const config = {
  "projects": {
    "c:/Users/jitro/Terminal": {
      "projectId": "246602ad-8de0-466e-bdad-55cc023e6502",
      "environmentId": "3704e786-5da1-49fa-bea5-11ed269cec38",
      "serviceId": "07fcda72-6e99-4d46-b8e6-a5335d74dd3a"
    }
  },
  "user": {
    "id": "64d4504f-bd8c-4543-90f5-cebb83633e9d",
    "token": null,
    "accessToken": "l62UOT6uElvGSDVMPno4IWGFU4MOfty8tExxK4Lgzn1",
    "refreshToken": "N3GtUgeJ4NHHKdiKpLMeF1TwGQvXxvPDqAOoL3uACqc",
    "tokenExpiresAt": 1783952855
  },
  "editor": null,
  "linkedFunctions": null,
  "sandboxes": null,
  "activeSandbox": null,
  "sandboxTemplates": null
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Written to:', configPath);
console.log(fs.readFileSync(configPath, 'utf8').substring(0, 100));
