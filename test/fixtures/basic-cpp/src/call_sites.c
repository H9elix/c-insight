static volatile int report_sink;

static void report(const char *name, int value)
{
    report_sink += name[0] + value;
}

static int add(int left, int right)
{
    report("left", left);
    report("right", right);
    return left + right;
}

typedef struct MemberFixture {
    int value;
} MemberFixture;

static MemberFixture member_fallback;

static MemberFixture *member_factory(void)
{
    return &member_fallback;
}

static int member_total(MemberFixture *selected, MemberFixture *other)
{
    int result = selected->value;
    result += selected->value;
    result += other->value;
    result += member_factory()->value;
    return result;
}

int main(void)
{
    MemberFixture selected = { 1 };
    MemberFixture other = { 2 };
    int value = add(1, 2);
    report("first", value);
    report("second", value + 1);
    report("third", value + 2);
    return report_sink + member_total(&selected, &other);
}
