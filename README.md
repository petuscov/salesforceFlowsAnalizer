# Salesforce Flows Analizer

Simple validation, but useful specially in devops systems where in git there are merges over Salesforce Flows. This validation allows to identify if the flow after the merge has any inconsistency.

Script that verifies:
- if all positionable flow elements are referenced (loops disconected from main flow pass the validation, but this is an odd scenario)
- if there is any sensible element (CRUD Operations, Subflows, ApexCalls) inside a loop. (This provides some good practises verification)

Ignore the Spanish comments inside the script :D
