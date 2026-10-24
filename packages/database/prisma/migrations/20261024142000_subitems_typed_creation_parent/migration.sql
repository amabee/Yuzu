-- A child CREATE cannot hide its dependency solely inside JSON.
ALTER TABLE "BoardProposal" ADD CONSTRAINT "BoardProposal_typed_parent_check"
CHECK ("operation" <> 'CREATE' OR "parentTaskId" IS NOT DISTINCT FROM ("changes"->>'parentId'));
