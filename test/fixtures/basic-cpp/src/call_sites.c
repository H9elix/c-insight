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

int main(void)
{
    int value = add(1, 2);
    report("first", value);
    report("second", value + 1);
    report("third", value + 2);
    return report_sink;
}
