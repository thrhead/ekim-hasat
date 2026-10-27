CREATE FUNCTION reject_harvest_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Harvests are immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER harvests_immutable
  BEFORE UPDATE OR DELETE ON harvests
  FOR EACH ROW EXECUTE FUNCTION reject_harvest_mutation();
